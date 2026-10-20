<?php
/**
 * crashtest WP adapter — in-process WordPress attack runner (v0.3 spike).
 *
 * The invariant (PRD principle 2) translated to PHP: this worker opens NO
 * socket. A Node parent feeds NDJSON attack envelopes on STDIN — one JSON
 * line per request — and reads one NDJSON response per line on STDOUT. The
 * worker boots a real WordPress load exactly once (wp-load.php), so every
 * attack request afterward dispatches through WP's own hook surface
 * (admin_post / template_redirect) in-process, at wp-load speed instead of
 * per-request HTTP.
 *
 * Request envelope (one JSON line in):
 *   { "id":"r1", "kind":"request",
 *     "method":"POST", "url":"/wp-admin/admin-post.php?action=fm_x&q=1",
 *     "headers":{"host":"example.test", …},
 *     "body":"a=1&b=2",            // urlencoded; parsed into $_POST + $_REQUEST
 *     "remoteAddr":"203.0.113.7",  // pins the rate-limiter bucket
 *     "cookies":{"fm_portal":"…"}, // replaces $_COOKIE wholesale
 *     "userId":1 | null,           // null/0 = the visit is logged out
 *     "dispatch":"admin_post" | "template_redirect",
 *     "action":"fm_ticket_purchase" }
 *
 *   { "id":"s1", "kind":"state",   "op":"…", … }  // fixed whitelist below
 *   { "id":"c1", "kind":"call",    "fn":"…", "args":[…] } // fn must be in CALL_ALLOW
 *
 * Response envelope (one JSON line out):
 *   { "id":"r1", "status":200|302|null, "headers":{…}, "body":"…",
 *     "redirect":"…|null", "wp_die":0|1, "fatal":"…", "ops":{"queries":N} }
 *
 * Fatal handling: a PHP fatal mid-request can't unwind into this loop, so
 * the worker flushes the envelope with `fatal` set and exits non-zero; the
 * Node parent transparently respawns and continues (WP holds no cross-
 * request state here). Redirects (wp_safe_redirect funnels through the
 * wp_redirect filter) and wp_die() are captured as thrown transfers BEFORE
 * they can exit the loop.
 *
 * Env/argv: $argv[1] (or KHF_WP_ROOT) = the WordPress root to bootstrap.
 * The worker is framework-agnostic: it wires WP itself; it knows nothing
 * about any plugin. Target-specific money paths run only through the
 * CALL_ALLOW whitelist (caller-supplied scenario seeds).
 */

error_reporting( E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_STRICT );
ini_set( 'display_errors', 'stderr' );
ini_set( 'display_startup_errors', 'stderr' );

define( 'WP_USE_THEMES', false ); // load WP; never render a theme on GETs
define( 'SAVEQUERIES', true );    // op counters ride the envelope

$cr = getenv( 'KHF_WP_ROOT' ) ?: ( $argv[1] ?? '' );
if ( ! $cr || ! is_file( $cr . '/wp-load.php' ) ) {
	fwrite( STDERR, "ct-worker: no wp-load at root\n" );
	exit( 2 );
}
chdir( $cr );
require $cr . '/wp-load.php';

if ( ! ob_get_level() ) {
	ob_start(); // collect WP's boot-time notices into a discarded buffer
}

/* --- transfer capture: redirects + wp_die become structured payloads ------ */

class CT_Transfer extends Exception {
	public $kind = '';
	public $status = 0;
	public $location = '';
	public $die_html = '';
}
class CT_Redirect extends CT_Transfer { }
class CT_Die extends CT_Transfer { }

// Redirect capture: wp_safe_redirect() funnels through wp_redirect()'s filter.
add_filter( 'wp_redirect', function ( $location, $status ) {
	$e           = new CT_Redirect( 'redirect' );
	$e->kind     = 'redirect';
	$e->status   = (int) ( $status ? $status : 302 );
	$e->location = (string) $location;
	throw $e;
}, 999, 2 );

// wp_die capture: admin-post refusals (capability/nonce die paths) come out
// with their response code + message; the JS-side verdicts read both.
add_filter( 'wp_die_handler', function () {
	return function ( $message, $title = '', $args = array() ) {
		$e = new CT_Die( 'wp_die' );
		$e->kind = 'wp_die';
		$e->status = (int) ( isset( $args['response'] ) ? $args['response'] : 500 );
		$e->die_html = is_string( $message ) ? $message : ( is_wp_error( $message ) ? $message->get_error_message() : '' );
		throw $e;
	};
}, 10 );

/* --- the envelope helpers -------------------------------------------------- */

function ct_headcount() {
	global $wpdb;
	return isset( $wpdb->queries ) ? count( (array) $wpdb->queries ) : 0;
}

function ct_emit( $id, array $fields ) {
	$fields['id']  = (string) $id;
	$fields['ops'] = array( 'queries' => ct_headcount() );
	if ( ob_get_level() ) { ob_end_clean(); } // boot noise never rides the pipe
	fwrite( STDOUT, json_encode( $fields, JSON_UNESCAPED_SLASHES ) . "\n" );
}

/** A non-transfer Throwable means the handler faulted — flush + die. The parent respawns. */

/* --- fixed whitelist for 'call' (scenario seeders only — nothing fuzz-reachable) --- */
const CALL_ALLOW = array( 'fm_mark_registration_paid' => 3, 'wp_create_nonce' => 1, 'fm_portal_ensure_person' => 1 );

function ct_simple( $v ) {
	return array(
		'status'   => 200,
		'headers'  => new stdClass(),
		'body'     => is_scalar( $v ) || null === $v ? (string) ( $v ?? '' ) : wp_json_encode( $v ),
		'redirect' => null,
		'wp_die'   => 0,
		'fatal'    => null,
	);
}

/* --- state ops (fixture oracles: scope everything by the caller's prefix) --- */

function ct_handle( $req ) {
	switch ( (string) ( $req['kind'] ?? '' ) ) {
		case 'request': return ct_run_request( $req );
		case 'state':   return ct_run_state( $req );
		case 'call':    return ct_run_call( $req );
	}
	$f = ct_simple( null );
	$f['fatal'] = 'bad kind: ' . (string) ( $req['kind'] ?? '' );
	return $f;
}

function ct_run_state( $req ) {
	$prefix = (string) ( $req['prefix'] ?? '' );
	switch ( (string) ( $req['op'] ?? '' ) ) {
		case 'count-emails': // registrations matching an email prefix (attack fixture scoping)
			$hit = (array) get_posts( array(
				'post_type' => 'fm_registration', 'post_status' => 'any',
				'posts_per_page' => -1, 'fields' => 'ids',
				'meta_query' => array( array( 'key' => '_fm_reg_email', 'value' => $prefix, 'compare' => 'LIKE' ) ),
			) );
			return ct_simple( count( $hit ) );
		case 'postmeta': // one meta value on one post — the money/txn/paid oracle
			return ct_simple( get_post_meta( (int) ( $req['id'] ?? 0 ), (string) ( $req['key'] ?? '' ), true ) );
		case 'delete-emails': // fixture cleanup (uses the real delete, hard-delete)
			$n = 0;
			foreach ( (array) get_posts( array(
				'post_type' => 'fm_registration', 'post_status' => 'any',
				'posts_per_page' => -1, 'fields' => 'ids',
				'meta_query' => array( array( 'key' => '_fm_reg_email', 'value' => $prefix, 'compare' => 'LIKE' ) ),
			) ) as $pid ) { wp_delete_post( (int) $pid, true ); $n++; }
			return ct_simple( $n );
		case 'setting': // ONE whitelisted fixture key — the receiver the attacks bind to
			if ( 'fm_paypal_email' !== (string) ( $req['key'] ?? '' ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'setting key not allowed';
				return $f;
			}
			if ( isset( $req['value'] ) ) {
				$s = (array) get_option( 'fm_settings', array() );
				$s['fm_paypal_email'] = (string) $req['value'];
				update_option( 'fm_settings', $s, false );
			}
			$s2 = (array) get_option( 'fm_settings', array() );
			return ct_simple( isset( $s2['fm_paypal_email'] ) ? $s2['fm_paypal_email'] : '' );
		// fixture teardown for OTHER record types (portal people etc.) — the
		// restore-what-you-touch rule needs a delete that covers person rows
		case 'delete-post':
			$found = get_posts( array(
					'post_type' => (string) ( $req['postType'] ?? '' ),
					'post_status' => 'any', 'posts_per_page' => 5, 'fields' => 'ids',
					'title' => (string) ( $req['title'] ?? '' ),
			) );
			$n = 0;
			foreach ( (array) $found as $pid ) { wp_delete_post( (int) $pid, true ); $n++; }
			return ct_simple( $n );
		case 'mkreg': // fixture seed: one empty registration; email = prefix-id@…
			$pid = wp_insert_post( array(
				'post_type' => 'fm_registration', 'post_status' => 'publish',
				'post_title' => 'CT seed ' . $prefix . ' ' . time(),
			) );
			if ( is_wp_error( $pid ) || ! $pid ) { return ct_simple( 0 ); }
			update_post_meta( (int) $pid, '_fm_reg_email', $prefix . '-' . (int) $pid . '@probe.example.org' );
			update_post_meta( (int) $pid, '_fm_reg_type', (string) ( $req['type'] ?? 'ticket' ) );
			return ct_simple( (int) $pid );
	}
	$f = ct_simple( null );
	$f['fatal'] = 'unknown state op';
	return $f;
}

/** The whitelist executor: real production paths, never user/array-fuzz input. */
function ct_run_call( $req ) {
	$fn = (string) ( $req['fn'] ?? '' );
	if ( ! array_key_exists( $fn, CALL_ALLOW ) || ! function_exists( $fn ) ) {
		$f = ct_simple( null );
		$f['fatal'] = 'call not allowed: ' . $fn;
		return $f;
	}
	$args = array_values( (array) ( $req['args'] ?? array() ) );
	if ( count( $args ) > (int) CALL_ALLOW[ $fn ] ) { $args = array_slice( $args, 0, (int) CALL_ALLOW[ $fn ] ); }
	// display quarantine: WP's boot may have flipped display_errors back on
	// (the khf heredoc interpolation warning surfaced this). The whitelist
	// calls must return their value clean; the handler's own envelopes keep
	// the warning-soup text (that is evidence, not noise).
	$prev_disp = ini_get( 'display_errors' );
	ini_set( 'display_errors', '0' );
	$cur = error_reporting();
	error_reporting( 0 );
	$ret = call_user_func_array( $fn, $args );
	error_reporting( $cur );
	ini_set( 'display_errors', (string) $prev_disp );
	return ct_simple( $ret );
}

/* --- the request runner: superglobal surgery + the REAL dispatch ----------- */

function ct_run_request( $req ) {
	$method = strtoupper( (string) ( $req['method'] ?? 'GET' ) );
	$url    = (string) ( $req['url'] ?? '/' );
	$parts  = wp_parse_url( $url );
	$query  = array();
	if ( ! empty( $parts['query'] ) ) { wp_parse_str( (string) $parts['query'], $query ); }

	$_GET = $query;
	$_POST = array();
	$_REQUEST = (array) $query;
	if ( 'GET' !== $method ) {
		$post = array();
		wp_parse_str( (string) ( $req['body'] ?? '' ), $post );
		$_POST    = $post;
		$_REQUEST = array_merge( $_REQUEST, $post );
	} elseif ( isset( $req['body'] ) && '' !== (string) $req['body'] ) {
		$post = array();
		wp_parse_str( (string) $req['body'], $post );
		$_GET = array_merge( $_GET, $post );
		$_REQUEST = array_merge( $_REQUEST, $post );
	}

	$_SERVER['REQUEST_METHOD'] = $method;
	$_SERVER['REQUEST_URI']    = $url;
	if ( isset( $req['remoteAddr'] ) ) { $_SERVER['REMOTE_ADDR'] = (string) $req['remoteAddr']; }
	if ( empty( $_SERVER['REMOTE_ADDR'] ) ) { $_SERVER['REMOTE_ADDR'] = '127.0.0.1'; }
	foreach ( (array) ( $req['headers'] ?? array() ) as $hk => $hv ) {
		$_SERVER[ 'HTTP_' . strtoupper( str_replace( '-', '_', (string) $hk ) ) ] = (string) $hv;
	}

	$_COOKIE = array();
	foreach ( (array) ( $req['cookies'] ?? array() ) as $ck => $cv ) { $_COOKIE[ (string) $ck ] = (string) $cv; }

	$uid = isset( $req['userId'] ) ? (int) $req['userId'] : 0;
	if ( $uid ) { wp_set_current_user( $uid ); }

	$out = array( 'status' => null, 'headers' => new stdClass(), 'body' => '', 'redirect' => null, 'wp_die' => 0, 'fatal' => null );
	try {
		switch ( (string) ( $req['dispatch'] ?? 'admin_post' ) ) {
			case 'template_redirect': // front-end surfaces (IPN receiver, gate view, portal GET)
				do_action( 'template_redirect' );
				$out['status'] = 200;
				break;
			case 'admin_post':
			default:
				$action = (string) ( $req['action'] ?? '' );
				// admin-post.php's own behavior: logged-out hits land on nopriv.
				if ( $uid ) {
					do_action( 'admin_post_' . $action );
				} else {
					do_action( 'admin_post_nopriv_' . $action );
				}
				$out['status'] = 200;
				$out['body']   = 'handled';
		}
	} catch ( CT_Redirect $r ) {
		$out['status']   = $r->status;
		$out['redirect'] = $r->location;
	} catch ( CT_Die $d ) {
		$out['status'] = $d->status;
		$out['body']   = $d->die_html;
		$out['wp_die'] = 1;
	}
	return $out;
}

/* --- the NDJSON loop ------------------------------------------------------- */

while ( true ) {
	$line = fgets( STDIN );
	if ( false === $line ) { break; } // parent closed: done
	$line = trim( (string) $line );
	if ( '' === $line ) { continue; }
	$req = json_decode( $line, true );
	if ( ! is_array( $req ) || ! isset( $req['id'] ) ) {
		fwrite( STDERR, "ct-worker: skip malformed line\n" );
		continue;
	}
	$ct_id = (string) $req['id'];
	ob_start(); // any stray echo becomes the body (never the protocol stream)
	try {
		$resp = ct_handle( $req );
		$stale = ob_get_clean();
		if ( '' !== trim( $stale ) ) {
			$resp['body'] = (string) $resp['body'] === '' ? $stale : ( $resp['body'] . "\n" . $stale );
		}
		ct_emit( $ct_id, $resp );
	} catch ( CT_Transfer $t ) {
		$stale = ob_get_clean();
		ct_emit( $ct_id, array(
			'status'   => $t->status ? $t->status : null,
			'headers'  => new stdClass(),
			'redirect' => $t->location ? $t->location : null,
			'wp_die'   => ( 'wp_die' === $t->kind ) ? 1 : 0,
			'body'     => $t->die_html,
			'fatal'    => null,
		) );
		continue;
	} catch ( Throwable $t ) {
		if ( ob_get_level() ) { ob_end_clean(); }
		ct_emit( $ct_id, array(
			'status'   => null,
			'headers'  => new stdClass(),
			'redirect' => null,
			'wp_die'   => 0,
			'body'     => '',
			'fatal'    => get_class( $t ) . ': ' . $t->getMessage() . ' @ ' . basename( $t->getFile() ) . ':' . $t->getLine(),
		) );
		fwrite( STDERR, "ct-worker: request fault — exiting for respawn\n" );
		exit( 1 );
	}
}
exit( 0 );
