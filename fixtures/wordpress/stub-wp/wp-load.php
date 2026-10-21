<?php
/**
 * crashtest WP lane - STUB WordPress core (deterministic, in-memory).
 *
 * Purpose: the generic worker (../wp-worker.php) requires a wp-load.php.
 * Real WordPress exists only in a target's own run root (the khf-style
 * case); this stub gives every checkout - CI included - a bootable WP-
 * shaped core so the harness + packs can be exercised END TO END without
 * a live install. It is a fixture, not a fork: it implements exactly the
 * surface the worker and the shipped packs use, at wp-load speed, no DB,
 * no time calls (determinism).
 *
 * The role layer lives HERE (that was the missing fixture from the PRD's
 * wp-roles gap list): wp_set_current_user / get_current_user_id /
 * current_user_can read ONLY the seeded $ct_users store, never request
 * input - and a couple of role-gated admin_post callbacks (ct_role_probe)
 * are registered like a well-written plugin would: priv hook carries
 * current_user_can('manage_options'), the nopriv hook refuses outright.
 *
 * Seeding crosses the generic CALL_ALLOW whitelist (worker rule: targets
 * teach specifics): ct_create_user($id, $roles) / ct_reset_users().
 */

error_reporting( E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_STRICT );
ini_set( 'display_errors', 'stderr' );

if ( ! defined( 'SAVEQUERIES' ) ) { define( 'SAVEQUERIES', true ); }
if ( ! defined( 'WP_USE_THEMES' ) ) { define( 'WP_USE_THEMES', false ); }

/* --- state: hooks, options, posts, meta, users ---------------------------- */

$GLOBALS['ct_hooks']        = array( 'filters' => array(), 'actions' => array() );
$GLOBALS['ct_options']      = array(
	'blogname' => 'CT Stub WordPress',
	'ct_roles' => array( 'administrator', 'editor', 'subscriber' ),
);
$GLOBALS['ct_posts']        = array();
$GLOBALS['ct_post_meta']    = array();
$GLOBALS['ct_next_post_id'] = 1;
$GLOBALS['ct_users']        = array(
	1 => array( 'roles' => array( 'administrator' ) ), // the built-in admin
);

$GLOBALS['wpdb'] = new class() {
	public $queries = array();
	public function query( $sql ) {
		$this->queries[] = (string) $sql;
		return 1;
	}
};

/* --- hooks --------------------------------------------------------------- */

function add_filter( $tag, $cb, $priority = 10, $accepted_args = 1 ) {
	global $ct_hooks;
	$ct_hooks['filters'][ (string) $tag ][] = compact( 'cb', 'priority', 'accepted_args' );
	return true;
}

function add_action( $tag, $cb, $priority = 10, $accepted_args = 1 ) {
	// Actions live in their OWN bag - delegating to add_filter here was the
	// boot bug of round one (do_action read an empty registry).
	global $ct_hooks;
	$ct_hooks['actions'][ (string) $tag ][] = compact( 'cb', 'priority', 'accepted_args' );
	return true;
}

function ct_sorted( $list, $tag ) {
	usort( $list, static function ( $a, $b ) { return $a['priority'] <=> $b['priority']; } );
	return $list;
}

function apply_filters( $tag, $value, ...$extra ) {
	global $ct_hooks;
	foreach ( ct_sorted( $ct_hooks['filters'][ (string) $tag ] ?? array(), $tag ) as $hook ) {
		$args   = array_merge( array( $value ), array_slice( $extra, 0, (int) $hook['accepted_args'] - 1 ) );
		$value  = call_user_func_array( $hook['cb'], $args );
	}
	return $value;
}

function do_action( $tag, ...$args ) {
	global $ct_hooks;
	foreach ( ct_sorted( $ct_hooks['actions'][ (string) $tag ] ?? array(), $tag ) as $hook ) {
		call_user_func_array( $hook['cb'], array_slice( $args, 0, (int) $hook['accepted_args'] ) );
	}
}

/* --- options ------------------------------------------------------------- */

function get_option( $name, $default = false ) {
	global $ct_options;
	return array_key_exists( (string) $name, $ct_options ) ? $ct_options[ (string) $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	global $ct_options;
	$ct_options[ (string) $name ] = $value;
	return true;
}

/* --- posts + meta --------------------------------------------------------- */

class WP_Error {
	public $code;
	public $message;
	public function __construct( $code = '', $message = '' ) {
		$this->code    = (string) $code;
		$this->message = (string) $message;
	}
	public function get_error_message() { return $this->message; }
}

function is_wp_error( $thing ) { return $thing instanceof WP_Error; }

function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }

function wp_insert_post( $arr ) {
	global $ct_posts, $ct_post_meta, $ct_next_post_id;
	$wpdb  = $GLOBALS['wpdb'];
	$wpdb->queries[] = 'INSERT post';
	$id = $ct_next_post_id++;
	$ct_posts[ $id ] = array(
		'ID'          => $id,
		'post_type'   => (string) ( $arr['post_type'] ?? 'post' ),
		'post_status' => (string) ( $arr['post_status'] ?? 'publish' ),
		'post_title'  => (string) ( $arr['post_title'] ?? '' ),
	);
	$ct_post_meta[ $id ] = array();
	return $id;
}

function update_post_meta( $id, $key, $value ) {
	global $ct_post_meta;
	$ct_post_meta[ (int) $id ][ (string) $key ] = $value;
	return true;
}

function get_post_meta( $id, $key, $single = false ) {
	global $ct_post_meta;
	return $ct_post_meta[ (int) $id ][ (string) $key ] ?? '';
}

function get_posts( $args ) {
	global $ct_posts, $ct_post_meta;
	$wpdb = $GLOBALS['wpdb'];
	$wpdb->queries[] = 'SELECT posts';
	$type   = (string) ( $args['post_type'] ?? 'post' );
	$status = (string) ( $args['post_status'] ?? 'publish' );
	$mq     = (array) ( $args['meta_query'] ?? array() );
	$hits   = array();
	foreach ( $ct_posts as $id => $row ) {
		if ( $row['post_type'] !== $type ) { continue; }
		if ( $status !== 'any' && $row['post_status'] !== $status ) { continue; }
		$ok = true;
		foreach ( $mq as $clause ) {
			$key     = (string) ( $clause['key'] ?? '' );
			$want    = (string) ( $clause['value'] ?? '' );
			$compare = (string) ( $clause['compare'] ?? 'LIKE' );
			$have    = (string) ( $ct_post_meta[ $id ][ $key ] ?? '' );
			$ok = ( 'LIKE' === $compare ) ? ( '' !== $want && false !== strpos( $have, $want ) ) : ( $have === $want );
			if ( ! $ok ) { break; }
		}
		if ( $ok ) { $hits[] = ( (string) ( $args['fields'] ?? '' ) === 'ids' ) ? $id : $row; }
	}
	return $hits;
}

function wp_delete_post( $id, $force = false ) {
	global $ct_posts, $ct_post_meta;
	$wpdb = $GLOBALS['wpdb'];
	$wpdb->queries[] = 'DELETE post';
	$id = (int) $id;
	if ( ! isset( $ct_posts[ $id ] ) ) { return false; }
	unset( $ct_posts[ $id ], $ct_post_meta[ $id ] );
	return $id;
}

/* --- users + the role layer ------------------------------------------------ */

$ct_roles_map = array(
	'administrator' => array( 'read' => true, 'edit_posts' => true, 'manage_options' => true ),
	'editor'        => array( 'read' => true, 'edit_posts' => true ),
	'subscriber'    => array( 'read' => true ),
);
$GLOBALS['ct_roles_map'] = $ct_roles_map;
$GLOBALS['ct_current_user_id'] = 0;

function wp_set_current_user( $id ) {
	$GLOBALS['ct_current_user_id'] = (int) $id;
	return (int) $id;
}

function get_current_user_id() { return (int) $GLOBALS['ct_current_user_id']; }

function wp_get_current_user() {
	global $ct_users, $ct_current_user_id;
	$id = (int) $ct_current_user_id;
	return array(
		'ID'    => $id,
		'roles' => $ct_users[ $id ]['roles'] ?? array(),
	);
}

/**
 * The ONLY capability authority in the stub: the seeded role store.
 * Request input (body roles, cookies, headers) never reaches this -
 * which is exactly the property the wp-roles pack probes for on real code.
 */
function current_user_can( $cap ) {
	global $ct_users, $ct_current_user_id, $ct_roles_map;
	$id    = (int) $ct_current_user_id;
	$roles = $ct_users[ $id ]['roles'] ?? array();
	foreach ( $roles as $role ) {
		if ( ! empty( $ct_roles_map[ $role ][ (string) $cap ] ) ) { return true; }
	}
	return false;
}

/* Seeded identity helpers (whitelist-gated on the JS side via callAllow). */
function ct_create_user( $id, $roles ) {
	global $ct_users;
	$id               = (int) $id;
	$ct_users[ $id ]  = array( 'roles' => array_values( (array) $roles ) );
	return $id;
}

function ct_grant_role( $id, $role ) {
	global $ct_users;
	$id = (int) $id;
	if ( ! isset( $ct_users[ $id ] ) ) { return false; }
	$ct_users[ $id ]['roles'][] = (string) $role;
	return true;
}

function ct_reset_users() {
	global $ct_users;
	$ct_users = array( 1 => array( 'roles' => array( 'administrator' ) ) );
	return 1;
}

function ct_list_roles() { return get_option( 'ct_roles', array() ); }

/* --- nonces (deterministic; one stub query so cost meters tick) ------------ */

function wp_create_nonce( $action ) {
	$GLOBALS['wpdb']->queries[] = 'INSERT nonce';
	return 'ctnonce-' . md5( 'nonce:' . (string) $action );
}

function check_admin_referer( $action = '', $field = 'nonce' ) {
	$want = wp_create_nonce( (string) $action );
	if ( ! isset( $_REQUEST[ (string) $field ] ) || ! hash_equals( $want, (string) $_REQUEST[ $field ] ) ) {
		wp_die( 'bad nonce', __FUNCTION__, array( 'response' => 403 ) );
	}
	return true;
}

/* --- transfers: redirect + die (the worker captures both) ------------------ */

function wp_redirect( $location, $status = 302 ) {
	return apply_filters( 'wp_redirect', $location, (int) $status );
}

function wp_safe_redirect( $location, $status = 302 ) { return wp_redirect( $location, $status ); }

function wp_die( $message = '', $title = '', $args = array() ) {
	// WP resolves the die handler through the wp_die_handler filter; when no
	// filter is registered (a caller invoking wp_die outside the worker),
	// the chain value falls back to its own initial value - never a callback.
	$handler = apply_filters( 'wp_die_handler', function ( $m, $t, $a ) {
		fwrite( STDERR, 'wp_die event: ' . (string) $m . "\n" );
		exit( (int) ( $a['response'] ?? 0 ) );
	}, $message, $title, $args );
	call_user_func( $handler, $message, $title, is_array( $args ) ? $args : array() );
}

/* --- misc parser surface the worker uses ----------------------------------- */

function wp_parse_url( $url ) { return parse_url( (string) $url ); }

function wp_parse_str( $string, &$result ) {
	parse_str( (string) $string, $result );
	return;
}

/*////////////////////////////////////////////////////////////////////////////////

 The role-gated fixture callbacks: the registration layer the PRD's gap
 list asked for. `ct_role_probe` is written like a well-defended plugin
 callback:

   - the priv hook carries current_user_can('manage_options')
   - the nopriv hook refuses outright
   - the callback reports its granted role in the body so verdicts can
     differ "granted-as-who"

 The wp-roles pack attacks this surface and the seeded role store that
 backs it. On a real target, adopters point the pack's ctx at their own
 action names; the stub's names are the CI default vocabulary.

////////////////////////////////////////////////////////////////////////////////

*/

add_action( 'admin_post_ct_role_probe', 'ct_role_probe_priv' );

function ct_role_probe_priv() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'capability denied', 'ct_role_probe', array( 'response' => 403 ) );
	}
	$who = wp_get_current_user();
	echo 'probe-ok:' . implode( '|', (array) $who['roles'] );
}

add_action( 'admin_post_nopriv_ct_role_probe', 'ct_role_probe_nopriv' );

function ct_role_probe_nopriv() {
	// nopriv refuses outright - a registration here that WRITES would be
	// the classic role callback bypass the pack hunts on real code.
	wp_die( 'logged out', 'ct_role_probe', array( 'response' => 401 ) );
}

/* One front-end surface for dispatch-confusion probes (template_redirect). */
add_action( 'template_redirect', 'ct_role_probe_front' );

function ct_role_probe_front() {
	if ( is_wp_error( $GLOBALS['wpdb'] ) ) { return; } // never true; keeps the inspector honest
	echo ct_current_user_summary();
}

function ct_current_user_summary() {
	$who = wp_get_current_user();
	return 'front-user:' . (int) $who['ID'] . ':' . implode( '|', (array) $who['roles'] );
}

return true; // wp-load.php "boots"
