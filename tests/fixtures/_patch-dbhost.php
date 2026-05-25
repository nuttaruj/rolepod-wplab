<?php
// tests/fixtures/_patch-dbhost.php
//
// Patch the WP container's wp-config.php so DB_HOST is SAPI-conditional:
//   - cli SAPI (host wp-cli)  → 127.0.0.1:3307
//   - web SAPI (Apache)       → db:3306
//
// Idempotent — exits cleanly if already patched. Run via:
//   docker compose cp _patch-dbhost.php wordpress:/tmp/p.php
//   docker compose exec -T wordpress php /tmp/p.php

declare(strict_types=1);

const CFG_PATH = '/var/www/html/wp-config.php';
const MARKER   = 'rolepod-wplab:sapi-dbhost';

if (!is_file(CFG_PATH)) {
    fwrite(STDERR, "[patch] wp-config.php not found at " . CFG_PATH . "\n");
    exit(1);
}

$src = file_get_contents(CFG_PATH);
if ($src === false) {
    fwrite(STDERR, "[patch] could not read wp-config.php\n");
    exit(1);
}

if (str_contains($src, MARKER)) {
    fwrite(STDOUT, "[patch] already patched — no-op\n");
    exit(0);
}

// The wordpress image generates ALL DB_* constants via getenv_docker(...),
// which reads WORDPRESS_DB_* env vars and falls back to placeholders. From
// host wp-cli those env vars are absent, so DB_NAME defaults to 'wordpress',
// DB_USER to 'example username', etc. — and the connect fails.
//
// Strategy: inject a tiny putenv() block at the very top of wp-config.php
// (right after the opening <?php). When running under the CLI SAPI we
// populate the WORDPRESS_DB_* env vars with fixture creds. By the time the
// existing getenv_docker() function runs further down, getenv() returns our
// values. wp-cli loads wp-config.php twice (see comment in original) so the
// block must be idempotent — putenv() naturally is.
$guard = <<<'PHP'

// rolepod-wplab:sapi-dbhost — patched by tests/fixtures/install-wp.sh
if ( php_sapi_name() === 'cli' ) {
	foreach ( [
		'WORDPRESS_DB_HOST'     => '127.0.0.1:3307',
		'WORDPRESS_DB_NAME'     => 'wplab',
		'WORDPRESS_DB_USER'     => 'wplab',
		'WORDPRESS_DB_PASSWORD' => 'wplabpass',
		'WORDPRESS_DB_CHARSET'  => 'utf8',
		'WORDPRESS_DB_COLLATE'  => '',
	] as $__wplab_k => $__wplab_v ) {
		putenv( $__wplab_k . '=' . $__wplab_v );
	}
	unset( $__wplab_k, $__wplab_v );
}

PHP;

// Inject the guard right after the opening <?php tag. Use preg_replace_callback
// to avoid `$varname` inside $guard being misread as a back-reference.
$pattern = '/(<\?php\s*\n)/';
$count   = 0;
$new     = preg_replace_callback(
    $pattern,
    static function ( array $m ) use ( $guard ) {
        return $m[1] . $guard;
    },
    $src,
    1,
    $count
);

if ($new === null || $count !== 1) {
    fwrite(STDERR, "[patch] getenv_docker function not matched exactly once (count={$count}). Aborting.\n");
    exit(1);
}

if (file_put_contents(CFG_PATH, $new) === false) {
    fwrite(STDERR, "[patch] could not write wp-config.php\n");
    exit(1);
}

fwrite(STDOUT, "[patch] wp-config.php patched OK\n");
exit(0);
