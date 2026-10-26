<?php
/**
 * crashtest WP adapter - in-process WordPress attack runner (v0.3 spike).
 *
 * The invariant (PRD principle 2) translated to PHP: this worker opens NO
 * socket. A Node parent feeds NDJSON attack envelopes on STDIN - one JSON
 * line per request - and reads one NDJSON response per line on STDOUT. The
 * worker boots a real WordPress load exactly once (wp-load.php), so every
 * attack request afterward dispatches through WP's own hook surface
 * (admin_post / template_redirect) in-process, at wp-load speed instead of
 * per-request HTTP.
 *
 * Request envelope (one JSON line in):
 *   { "id":"r1", "kind":"request",
 *     "method":"POST", "url":"/wp-admin/admin-post.php?action=fm_x&q=1",
 *     "headers":{"host":"example.test", ...},
 *     "body":"a=1&b=2",            // urlencoded; parsed into $_POST + $_REQUEST
 *     "remoteAddr":"203.0.113.7",  // pins the rate-limiter bucket
 *     "cookies":{"fm_portal":"..."}, // replaces $_COOKIE wholesale
 *     "userId":1 | null,           // null/0 = the visit is logged out
 *     "dispatch":"admin_post" | "template_redirect",
 *     "action":"fm_ticket_purchase" }
 *
 *   { "id":"s1", "kind":"state",   "op":"...", ... }  // fixed whitelist below
 *   { "id":"c1", "kind":"call",    "fn":"...", "args":[...] } // fn must be in CALL_ALLOW
 *
 * Response envelope (one JSON line out):
 *   { "id":"r1", "status":200|302|null, "headers":{...}, "body":"...",
 *     "redirect":"...|null", "wp_die":0|1, "fatal":"...", "ops":{"queries":N} }
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

/** A non-transfer Throwable means the handler faulted - flush + die. The parent respawns. */

/* --- run-config: whitelists arrive on the FIRST 'cfg' envelope (one JSON
 line) from the JS adapter - fn => max-args pairs, hook => max-args pairs,
 plus the option names the caller's pack may read/write. Defaults = stock-safe:
 nothing plugin-specific is known here, because the worker is GENERIC (targets
 teach it their own specifics; PRD section 10 note + the wp adapter docs
 'who owns specifics'). --- */
$CT_CFG = array(
	'callAllow'    => array( 'wp_create_nonce' => 1 ),
	'allowOptions' => array(),
	'hookAllow'    => array(),
);

function ct_options_allowed() {
	global $CT_CFG;
	return array_flip( (array) ( $CT_CFG['allowOptions'] ?? array() ) );
}

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
		case 'cfg':    return ct_run_cfg( $req );
		case 'request': return ct_run_request( $req );
		case 'state':   return ct_run_state( $req );
		case 'call':    return ct_run_call( $req );
	}
	$f = ct_simple( null );
	$f['fatal'] = 'bad kind: ' . (string) ( $req['kind'] ?? '' );
	return $f;
}

/** The FIRST envelope every run: teach the generic worker this target's specifics. */
function ct_run_cfg( $req ) {
	global $CT_CFG;
	$CT_CFG['callAllow'] = array_map(
		'intval',
		(array) ( $req['callAllow'] ?? $CT_CFG['callAllow'] )
	);
	$CT_CFG['allowOptions'] = array_values( (array) ( $req['allowOptions'] ?? array() ) );
	$CT_CFG['hookAllow'] = array_map(
		'intval',
		(array) ( $req['hookAllow'] ?? array() )
	);
	return ct_simple( 'cfg-ok' );
}

function ct_run_state( $req ) {
	global $CT_CFG;
	/* --- generic state ops over WP primitives (posts, meta, options). The
	 plugin's OWN names - CPTs, meta keys, option rows, seeder functions -
	 arrive via the caller's pack and the cfg envelope; the worker knows none
	 of them (generic-adapter rule from the WP playbook + PRD section 10 note). --- */
	$prefix = (string) ( $req['prefix'] ?? '' );
	switch ( (string) ( $req['op'] ?? '' ) ) {
		case 'posts-query': // ids matching postType + optional meta key/value (fixture scoping or counts)
			$hit = (array) get_posts( array(
				'post_type' => (string) ( $req['postType'] ?? 'post' ), 'post_status' => 'any',
				'posts_per_page' => -1, 'fields' => 'ids',
			) );
			if ( null !== ( $req['metaKey'] ?? null ) ) {
				$hit = (array) get_posts( array(
					'post_type' => (string) ( $req['postType'] ?? 'post' ), 'post_status' => 'any',
					'posts_per_page' => -1, 'fields' => 'ids',
					'meta_query' => array( array(
						'key' => (string) $req['metaKey'],
						'value' => (string) ( $req['metaValue'] ?? '' ),
						'compare' => (string) ( $req['compare'] ?? 'LIKE' ),
					) ),
				) );
			}
			return ct_simple( $hit );
		case 'post-meta': // one meta value on one post - the money/txn/paid oracle
			return ct_simple( get_post_meta( (int) ( $req['id'] ?? 0 ), (string) ( $req['key'] ?? '' ), true ) );
		case 'delete-posts': // fixture teardown, hard-delete, scoped by the caller's own query
			$found = (array) get_posts( array(
				'post_type' => (string) ( $req['postType'] ?? 'post' ), 'post_status' => 'any',
				'posts_per_page' => -1, 'fields' => 'ids',
				'meta_query' => array( array(
					'key' => (string) ( $req['metaKey'] ?? '' ),
					'value' => (string) ( $req['metaValue'] ?? '' ),
					'compare' => (string) ( $req['compare'] ?? 'LIKE' ),
				) ),
			) );
			$n = 0;
			foreach ( $found as $pid ) { wp_delete_post( (int) $pid, true ); $n++; }
			return ct_simple( $n );
		case 'option': // read/write ONE option row - the config/fixture oracle (gated)
			$name = (string) ( $req['name'] ?? '' );
			if ( '' === $name || ! isset( ct_options_allowed()[ $name ] ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'option not allowed (declare it via allowOptions in your run-root config): ' . $name;
				return $f;
			}
			$row = get_option( $name, null );
			if ( ! array_key_exists( 'key', $req ) ) {
				// Whole-option read without slicing - scalars stay scalars, arrays
				// stay arrays (the pack narrows what it wants). The khf-style
				// settings rows are arrays; stock rows like blogname are strings.
				return ct_simple( $row );
			}
			$key = (string) $req['key'];
			if ( isset( $req['value'] ) ) {
				$slice = is_array( $row ) ? $row : array();
				$slice[ $key ] = $req['value'];
				update_option( $name, $slice, false );
				$row = get_option( $name, null );
			}
			$slice = is_array( $row ) ? $row : array();
			return ct_simple( array_key_exists( $key, $slice ) ? $slice[ $key ] : null );
		case 'insert-post': // fixture seed: one post of the caller's type, with the caller's meta
			$meta = (array) ( $req['meta'] ?? array() );
			// Deterministic seed identity (house law 4 translated to the PHP lane):
			// the title used to mint the wall clock - a moving value on a shipped
			// surface, so the same commit could seed differently depending on
			// when the campaign ran. A per-process counter instead: same run
			// shape, same label order, every time.
			static $ct_seed_seq = 0;
			$ct_seed_seq++;
			$pid = wp_insert_post( array_merge( array(
				'post_type' => (string) ( $req['postType'] ?? 'post' ),
				'post_status' => (string) ( $req['status'] ?? 'publish' ),
				'post_title' => 'CT seed ' . $prefix . ' #' . $ct_seed_seq,
			), (array) ( $req['fields'] ?? array() ) ) );
			if ( is_wp_error( $pid ) || ! $pid ) { return ct_simple( 0 ); }
			foreach ( $meta as $mk => $mv ) { update_post_meta( (int) $pid, (string) $mk, $mv ); }
			return ct_simple( (int) $pid );
		case 'postmeta': // kept for pack compatibility: alias of post-meta
			return ct_simple( get_post_meta( (int) ( $req['id'] ?? 0 ), (string) ( $req['key'] ?? '' ), true ) );

		case 'do-action': // (issue #35) fire ONE internal hook - whitelist-gated exactly
			                // like callAllow: plugin-side bridges complete money through
			                // hooks (woocommerce_order_status_* relays), not HTTP routes,
			                // and a hostile caller replaying completion hooks is the seam
			                // a pack has to reach. Undeclared = loud fatal, never silent.
			$hook = (string) ( $req['hook'] ?? '' );
			$allow = (array) ( $CT_CFG['hookAllow'] ?? array() );
			if ( '' === $hook || ! array_key_exists( $hook, $allow ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'hook not allowed (declare it via hookAllow in your run-root config): ' . $hook;
				return $f;
			}
			$args = array_values( (array) ( $req['args'] ?? array() ) );
			if ( count( $args ) > (int) $allow[ $hook ] ) { $args = array_slice( $args, 0, (int) $allow[ $hook ] ); }
			call_user_func_array( 'do_action', array_merge( array( $hook ), $args ) );
			return ct_simple( 'hook-fired' );

		/* --- WooCommerce order fixtures (issue #35): plugin-side payment bridges
		 bind + complete money on WC orders, so a pack needs the order vocabulary
		 IN-PROCESS: create (fee line item + binding meta), set-status (fires the
		 real woocommerce_order_status_* hooks), read meta the way the store
		 persists it (WC meta API works on both HPOS and legacy CPT stores; on a
		 legacy CPT store the same values ALSO read back through the post-meta op
		 on the order's own id - the cross-store replay surface these ops exist to
		 attack). They degrade LOUDLY where WooCommerce is not active; the stub WP
		 core carries the same vocabulary so CI teeth run without a live WC. --- */
		case 'wc-create-order':
			if ( ! function_exists( 'wc_get_order' ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'woocommerce is not active at this wp root - the wc-* op vocabulary needs an active WooCommerce install';
				return $f;
			}
			$ct_order = wc_create_order();
			if ( is_wp_error( $ct_order ) || ! $ct_order ) {
				$f = ct_simple( null );
				$f['fatal'] = 'wc-create-order: wc_create_order failed';
				return $f;
			}
			$ct_fee = (array) ( $req['fee'] ?? array() );
			if ( isset( $ct_fee['name'], $ct_fee['amount'] ) && class_exists( 'WC_Order_Item_Fee' ) ) {
				$ct_item = new WC_Order_Item_Fee();
				$ct_item->set_name( (string) $ct_fee['name'] );
				$ct_item->set_amount( (string) $ct_fee['amount'] );
				$ct_order->add_item( $ct_item );
			}
			foreach ( (array) ( $req['meta'] ?? array() ) as $ct_mk => $ct_mv ) {
				$ct_order->update_meta_data( (string) $ct_mk, $ct_mv );
			}
			if ( method_exists( $ct_order, 'calculate_totals' ) ) { $ct_order->calculate_totals(); }
			$ct_order->save();
			return ct_simple( array(
				'id'    => $ct_order->get_id(),
				'status' => $ct_order->get_status(),
				'total' => (string) $ct_order->get_total(),
			) );

		case 'wc-order-set-status': // the money trigger: set_status + save fires woocommerce_order_status_*
			if ( ! function_exists( 'wc_get_order' ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'woocommerce is not active at this wp root - the wc-* op vocabulary needs an active WooCommerce install';
				return $f;
			}
			$ct_order = wc_get_order( (int) ( $req['id'] ?? 0 ) );
			if ( ! $ct_order ) {
				$f = ct_simple( null );
				$f['fatal'] = 'wc-order-set-status: no order at id ' . (int) ( $req['id'] ?? 0 );
				return $f;
			}
			$ct_order->set_status( (string) ( $req['status'] ?? 'processing' ) );
			$ct_order->save();
			return ct_simple( array( 'id' => $ct_order->get_id(), 'status' => $ct_order->get_status() ) );

		case 'wc-order-get': // the oracle: id/status/total/currency via WC getters (store-agnostic)
			if ( ! function_exists( 'wc_get_order' ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'woocommerce is not active at this wp root - the wc-* op vocabulary needs an active WooCommerce install';
				return $f;
			}
			$ct_order = wc_get_order( (int) ( $req['id'] ?? 0 ) );
			if ( ! $ct_order ) {
				$f = ct_simple( null );
				$f['fatal'] = 'wc-order-get: no order at id ' . (int) ( $req['id'] ?? 0 );
				return $f;
			}
			return ct_simple( array(
				'id'       => $ct_order->get_id(),
				'status'   => $ct_order->get_status(),
				'total'    => (string) $ct_order->get_total(),
				'currency' => method_exists( $ct_order, 'get_currency' ) ? (string) $ct_order->get_currency() : '',
			) );

		case 'wc-order-get-meta': // binding-meta oracle - WC meta API, works on HPOS + legacy
			if ( ! function_exists( 'wc_get_order' ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'woocommerce is not active at this wp root - the wc-* op vocabulary needs an active WooCommerce install';
				return $f;
			}
			$ct_order = wc_get_order( (int) ( $req['id'] ?? 0 ) );
			if ( ! $ct_order ) {
				$f = ct_simple( null );
				$f['fatal'] = 'wc-order-get-meta: no order at id ' . (int) ( $req['id'] ?? 0 );
				return $f;
			}
			return ct_simple( $ct_order->get_meta( (string) ( $req['key'] ?? '' ), true ) );

		case 'wc-order-delete': // fixture teardown (playbook rule 1: restore what you touch)
			if ( ! function_exists( 'wc_get_order' ) ) {
				$f = ct_simple( null );
				$f['fatal'] = 'woocommerce is not active at this wp root - the wc-* op vocabulary needs an active WooCommerce install';
				return $f;
			}
			$ct_order = wc_get_order( (int) ( $req['id'] ?? 0 ) );
			if ( ! $ct_order ) { return ct_simple( 0 ); }
			$ct_order->delete( true );
			return ct_simple( 1 );

	}
	$f = ct_simple( null );
	$f['fatal'] = 'unknown state op';
	return $f;
}

/** The whitelist executor: real production paths, never user/array-fuzz input. */
function ct_run_call( $req ) {
	global $CT_CFG;
	$fn = (string) ( $req['fn'] ?? '' );
	$allow = (array) ( $CT_CFG['callAllow'] ?? array() );
	if ( ! array_key_exists( $fn, $allow ) || ! function_exists( $fn ) ) {
		$f = ct_simple( null );
		$f['fatal'] = 'call not allowed (declare it via callAllow in your run-root config): ' . $fn;
		return $f;
	}
	$args = array_values( (array) ( $req['args'] ?? array() ) );
	if ( count( $args ) > (int) $allow[ $fn ] ) { $args = array_slice( $args, 0, (int) $allow[ $fn ] ); }
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
		fwrite( STDERR, "ct-worker: request fault - exiting for respawn\n" );
		exit( 1 );
	}
}
exit( 0 );
