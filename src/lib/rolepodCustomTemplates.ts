/**
 * Templates for the `rolepod-custom` lazy-install plugin.
 *
 * The Rolepod Custom plugin is NOT bundled with rolepod-wp. It's written
 * to the target site on the FIRST `rolepod_wp_custom_task_scaffold` call
 * (or via explicit `rolepod_wp_custom_init`). Subsequent task scaffolds
 * re-use the existing plugin and just drop a new `Modules/<Name>Task.php`.
 *
 * Why a separate plugin (vs submenu under rolepod-wp)? Identity + lifecycle:
 *
 *   - rolepod-wp = AI bridge core (REST endpoints, recovery, ledger)
 *   - rolepod-custom = per-site bespoke features (one plugin per client site)
 *
 *   Deactivating rolepod-wp shouldn't kill custom features. Deactivating
 *   rolepod-custom shouldn't kill AI access. Update cycles independent.
 *
 * Structure delivered on init:
 *
 *   wp-content/plugins/rolepod-custom/
 *     rolepod-custom.php           — plugin header + bootstrap
 *     uninstall.php                — drops every rolepod_custom_* option
 *     inc/
 *       Plugin.php                 — main class, autoload + boot
 *       TaskRegistry.php           — glob Modules/*Task.php + instantiate
 *       BaseTask.php               — abstract: settings / hooks / uninstall plumbing
 *       AdminMenu.php              — top-level "Rolepod Custom" menu
 *       Modules/                   — empty until first task lands
 *     assets/
 *       admin.css                  — minimal styling
 *     readme.txt                   — wp.org-style metadata
 */
export const ROLEPOD_CUSTOM_PLUGIN_SLUG = "rolepod-custom";
export const ROLEPOD_CUSTOM_PLUGIN_DIR = `wp-content/plugins/${ROLEPOD_CUSTOM_PLUGIN_SLUG}`;
export const ROLEPOD_CUSTOM_MAIN_FILE = `${ROLEPOD_CUSTOM_PLUGIN_DIR}/rolepod-custom.php`;
export const ROLEPOD_CUSTOM_MODULES_DIR = `${ROLEPOD_CUSTOM_PLUGIN_DIR}/inc/Modules`;
export const ROLEPOD_CUSTOM_VERSION = "1.0.0";

export const TPL_MAIN_FILE = `<?php
/**
 * Plugin Name:       Rolepod Custom
 * Plugin URI:        https://github.com/nuttaruj/rolepod-wplab
 * Description:       Per-site bespoke features scaffolded by the rolepod-wplab AI bridge. Each feature is a "task" — a module under inc/Modules/ with its own settings page, hooks, and uninstall plumbing. Tasks land on demand via the rolepod_wp_custom_task_scaffold MCP tool.
 * Author:            nuttaruj
 * Version:           ${ROLEPOD_CUSTOM_VERSION}
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * License:           MIT
 * Text Domain:       rolepod-custom
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ROLEPOD_CUSTOM_VERSION', '${ROLEPOD_CUSTOM_VERSION}' );
define( 'ROLEPOD_CUSTOM_FILE', __FILE__ );
define( 'ROLEPOD_CUSTOM_DIR', plugin_dir_path( __FILE__ ) );
define( 'ROLEPOD_CUSTOM_URL', plugin_dir_url( __FILE__ ) );
define( 'ROLEPOD_CUSTOM_MENU_SLUG', 'rolepod-custom' );

// PSR-4 autoload (no Composer dependency).
spl_autoload_register( static function ( string $class ): void {
	$prefix = 'Rolepod\\\\Custom\\\\';
	if ( strpos( $class, $prefix ) !== 0 ) {
		return;
	}
	$relative = substr( $class, strlen( $prefix ) );
	$file = ROLEPOD_CUSTOM_DIR . 'inc/' . str_replace( '\\\\', '/', $relative ) . '.php';
	if ( is_file( $file ) ) {
		require $file;
	}
} );

add_action( 'plugins_loaded', static function (): void {
	\\Rolepod\\Custom\\Plugin::instance()->boot();
} );
`;

export const TPL_UNINSTALL = `<?php
/**
 * Drop every rolepod_custom_* option when the plugin is uninstalled.
 *
 * Per-task uninstall hooks should run BEFORE this — call each Task::uninstall()
 * via the BaseTask uninstall plumbing. The catch-all below is a safety net.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE 'rolepod_custom_%'" );
`;

export const TPL_PLUGIN_CLASS = `<?php
declare(strict_types=1);

namespace Rolepod\\Custom;

/**
 * Main plugin orchestrator.
 *
 * - Bootstraps the TaskRegistry (discovers Modules/*Task.php).
 * - Registers the top-level admin menu and per-task submenus.
 * - Wires each task's register_hooks() into WordPress.
 */
final class Plugin {

	private static ?Plugin $instance = null;
	private TaskRegistry $registry;
	private AdminMenu $admin_menu;

	public static function instance(): Plugin {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		$this->registry   = new TaskRegistry();
		$this->admin_menu = new AdminMenu( $this->registry );
	}

	public function boot(): void {
		$this->registry->discover();
		foreach ( $this->registry->all() as $task ) {
			$task->register_hooks();
		}
		if ( is_admin() ) {
			$this->admin_menu->register();
		}
	}

	public function registry(): TaskRegistry {
		return $this->registry;
	}
}
`;

export const TPL_TASK_REGISTRY = `<?php
declare(strict_types=1);

namespace Rolepod\\Custom;

/**
 * Glob inc/Modules/*Task.php, instantiate each, expose them by id.
 */
final class TaskRegistry {

	/** @var array<string, BaseTask> */
	private array $tasks = [];

	public function discover(): void {
		$dir = ROLEPOD_CUSTOM_DIR . 'inc/Modules';
		if ( ! is_dir( $dir ) ) {
			return;
		}
		foreach ( glob( $dir . '/*Task.php' ) as $file ) {
			$basename = basename( $file, '.php' );
			$class = 'Rolepod\\\\Custom\\\\Modules\\\\' . $basename;
			if ( ! class_exists( $class ) ) {
				continue;
			}
			$task = new $class();
			if ( ! ( $task instanceof BaseTask ) ) {
				continue;
			}
			$this->tasks[ $task->id() ] = $task;
		}
	}

	/** @return array<string, BaseTask> */
	public function all(): array {
		return $this->tasks;
	}

	public function get( string $id ): ?BaseTask {
		return $this->tasks[ $id ] ?? null;
	}

	public function exists( string $id ): bool {
		return isset( $this->tasks[ $id ] );
	}
}
`;

export const TPL_BASE_TASK = `<?php
declare(strict_types=1);

namespace Rolepod\\Custom;

/**
 * Contract every Rolepod Custom task must follow.
 *
 * Common plumbing in the base:
 *   - option_key()        rolepod_custom_<id>_settings
 *   - enabled_key()       rolepod_custom_<id>_enabled
 *   - settings()          merges stored option + defaults
 *   - is_enabled()        toggleable via the admin or a wplab tool
 *   - render_settings_page()  renders the form from settings_schema()
 *   - handle_settings_save()  sanitizes + saves via update_option
 *
 * Task subclasses must implement: id, title, description, settings_schema,
 * register_hooks, uninstall.
 */
abstract class BaseTask {

	abstract public function id(): string;
	abstract public function title(): string;
	abstract public function description(): string;

	/**
	 * Return per-field metadata for the settings form.
	 *
	 * @return array<string, array{type:string, label:string, default?:mixed, options?:array<int|string, string>, help?:string}>
	 */
	abstract public function settings_schema(): array;

	/**
	 * Wire add_action / add_filter calls. Subclasses should bail when
	 * is_enabled() is false so the toggle in the admin UI is honored.
	 */
	abstract public function register_hooks(): void;

	/**
	 * Inverse of register_hooks plus per-task cleanup (delete options,
	 * remove CPTs, etc). Called by the wplab remove tool.
	 */
	public function uninstall(): void {
		delete_option( $this->option_key() );
		delete_option( $this->enabled_key() );
	}

	public function option_key(): string {
		return 'rolepod_custom_' . str_replace( '-', '_', $this->id() ) . '_settings';
	}

	public function enabled_key(): string {
		return 'rolepod_custom_' . str_replace( '-', '_', $this->id() ) . '_enabled';
	}

	public function is_enabled(): bool {
		$v = get_option( $this->enabled_key(), 1 );
		return (int) $v === 1;
	}

	public function set_enabled( bool $on ): void {
		update_option( $this->enabled_key(), $on ? 1 : 0 );
	}

	/** @return array<string, mixed> */
	public function settings(): array {
		$stored = get_option( $this->option_key(), [] );
		if ( ! is_array( $stored ) ) {
			$stored = [];
		}
		$defaults = [];
		foreach ( $this->settings_schema() as $key => $meta ) {
			$defaults[ $key ] = $meta['default'] ?? '';
		}
		return array_merge( $defaults, $stored );
	}

	public function save_settings( array $input ): void {
		$clean = [];
		foreach ( $this->settings_schema() as $key => $meta ) {
			if ( ! isset( $input[ $key ] ) ) {
				continue;
			}
			$raw = $input[ $key ];
			$type = $meta['type'] ?? 'text';
			switch ( $type ) {
				case 'email':    $clean[ $key ] = sanitize_email( (string) $raw ); break;
				case 'url':      $clean[ $key ] = esc_url_raw( (string) $raw ); break;
				case 'number':   $clean[ $key ] = is_numeric( $raw ) ? (float) $raw : 0; break;
				case 'textarea': $clean[ $key ] = sanitize_textarea_field( (string) $raw ); break;
				case 'checkbox': $clean[ $key ] = ! empty( $raw ); break;
				case 'select':
					$options = $meta['options'] ?? [];
					$clean[ $key ] = isset( $options[ $raw ] ) ? (string) $raw : ($meta['default'] ?? '');
					break;
				case 'text':
				default:         $clean[ $key ] = sanitize_text_field( (string) $raw );
			}
		}
		update_option( $this->option_key(), $clean );
	}

	public function render_settings_page(): void {
		if ( isset( $_POST['rolepod_custom_save'] ) && check_admin_referer( 'rolepod_custom_save_' . $this->id() ) ) {
			$this->save_settings( $_POST['rolepod_custom_settings'] ?? [] );
			echo '<div class="notice notice-success"><p>Saved.</p></div>';
		}
		if ( isset( $_POST['rolepod_custom_toggle'] ) && check_admin_referer( 'rolepod_custom_toggle_' . $this->id() ) ) {
			$this->set_enabled( ! $this->is_enabled() );
		}
		$values = $this->settings();
		$enabled = $this->is_enabled();
		?>
		<div class="wrap rolepod-custom-task">
			<h1><?php echo esc_html( $this->title() ); ?></h1>
			<p class="description"><?php echo esc_html( $this->description() ); ?></p>
			<form method="post" style="margin-bottom:1em;">
				<?php wp_nonce_field( 'rolepod_custom_toggle_' . $this->id() ); ?>
				<input type="hidden" name="rolepod_custom_toggle" value="1" />
				<button class="button button-secondary">
					<?php echo $enabled ? 'Disable this task' : 'Enable this task'; ?>
				</button>
				<span style="margin-left:1em; color:<?php echo $enabled ? '#0a0' : '#a00'; ?>;">
					Currently: <?php echo $enabled ? 'ENABLED' : 'DISABLED'; ?>
				</span>
			</form>
			<form method="post">
				<?php wp_nonce_field( 'rolepod_custom_save_' . $this->id() ); ?>
				<input type="hidden" name="rolepod_custom_save" value="1" />
				<table class="form-table">
					<tbody>
					<?php foreach ( $this->settings_schema() as $key => $meta ) : ?>
						<tr>
							<th><label for="rc-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $meta['label'] ?? $key ); ?></label></th>
							<td><?php $this->render_field( $key, $meta, $values[ $key ] ?? '' ); ?></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
				<?php submit_button( 'Save settings' ); ?>
			</form>
		</div>
		<?php
	}

	protected function render_field( string $key, array $meta, $value ): void {
		$id = 'rc-' . $key;
		$name = 'rolepod_custom_settings[' . $key . ']';
		$type = $meta['type'] ?? 'text';
		switch ( $type ) {
			case 'textarea':
				printf( '<textarea id="%s" name="%s" rows="4" cols="50" class="large-text">%s</textarea>',
					esc_attr( $id ), esc_attr( $name ), esc_textarea( (string) $value ) );
				break;
			case 'checkbox':
				printf( '<input type="checkbox" id="%s" name="%s" value="1" %s />',
					esc_attr( $id ), esc_attr( $name ), checked( (bool) $value, true, false ) );
				break;
			case 'select':
				printf( '<select id="%s" name="%s">', esc_attr( $id ), esc_attr( $name ) );
				foreach ( ( $meta['options'] ?? [] ) as $val => $label ) {
					printf( '<option value="%s" %s>%s</option>',
						esc_attr( (string) $val ),
						selected( (string) $value, (string) $val, false ),
						esc_html( (string) $label ) );
				}
				echo '</select>';
				break;
			case 'number':
				printf( '<input type="number" id="%s" name="%s" value="%s" class="small-text" />',
					esc_attr( $id ), esc_attr( $name ), esc_attr( (string) $value ) );
				break;
			case 'email':
			case 'url':
			case 'text':
			default:
				printf( '<input type="%s" id="%s" name="%s" value="%s" class="regular-text" />',
					esc_attr( $type ),
					esc_attr( $id ), esc_attr( $name ), esc_attr( (string) $value ) );
		}
		if ( ! empty( $meta['help'] ) ) {
			printf( '<p class="description">%s</p>', esc_html( $meta['help'] ) );
		}
	}
}
`;

export const TPL_ADMIN_MENU = `<?php
declare(strict_types=1);

namespace Rolepod\\Custom;

/**
 * Top-level "Rolepod Custom" menu + Overview + per-task submenus.
 *
 * Task submenu titles come from \`Task::title()\` so user-facing labels match
 * what the user typed when they asked the AI to scaffold the task.
 */
final class AdminMenu {

	private TaskRegistry $registry;

	public function __construct( TaskRegistry $registry ) {
		$this->registry = $registry;
	}

	public function register(): void {
		add_action( 'admin_menu', [ $this, 'add_menus' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
	}

	public function add_menus(): void {
		add_menu_page(
			'Rolepod Custom',
			'Rolepod Custom',
			'manage_options',
			ROLEPOD_CUSTOM_MENU_SLUG,
			[ $this, 'render_overview' ],
			'dashicons-admin-generic',
			59
		);
		add_submenu_page(
			ROLEPOD_CUSTOM_MENU_SLUG,
			'Overview',
			'Overview',
			'manage_options',
			ROLEPOD_CUSTOM_MENU_SLUG,
			[ $this, 'render_overview' ]
		);
		foreach ( $this->registry->all() as $task ) {
			$slug = ROLEPOD_CUSTOM_MENU_SLUG . '-' . $task->id();
			add_submenu_page(
				ROLEPOD_CUSTOM_MENU_SLUG,
				$task->title(),
				$task->title(),
				'manage_options',
				$slug,
				static function () use ( $task ) {
					$task->render_settings_page();
				}
			);
		}
	}

	public function enqueue_assets( string $hook ): void {
		if ( strpos( $hook, ROLEPOD_CUSTOM_MENU_SLUG ) === false ) {
			return;
		}
		wp_enqueue_style(
			'rolepod-custom-admin',
			ROLEPOD_CUSTOM_URL . 'assets/admin.css',
			[],
			ROLEPOD_CUSTOM_VERSION
		);
	}

	public function render_overview(): void {
		$tasks = $this->registry->all();
		?>
		<div class="wrap rolepod-custom-overview">
			<h1>Rolepod Custom</h1>
			<p class="description">Per-site bespoke features scaffolded by the rolepod-wplab AI bridge. Each row below is a registered task.</p>
			<?php if ( empty( $tasks ) ) : ?>
				<p><em>No tasks registered yet. Ask Claude / Cursor / Codex to scaffold one via <code>rolepod_wp_custom_task_scaffold</code>.</em></p>
			<?php else : ?>
				<table class="widefat striped">
					<thead>
						<tr>
							<th>Task</th>
							<th>ID</th>
							<th>Status</th>
							<th>Description</th>
							<th>Settings</th>
						</tr>
					</thead>
					<tbody>
					<?php foreach ( $tasks as $task ) :
						$slug = ROLEPOD_CUSTOM_MENU_SLUG . '-' . $task->id();
						$url = admin_url( 'admin.php?page=' . $slug );
						$on = $task->is_enabled();
					?>
						<tr>
							<td><strong><?php echo esc_html( $task->title() ); ?></strong></td>
							<td><code><?php echo esc_html( $task->id() ); ?></code></td>
							<td><span style="color:<?php echo $on ? '#0a0' : '#a00'; ?>;"><?php echo $on ? 'enabled' : 'disabled'; ?></span></td>
							<td><?php echo esc_html( $task->description() ); ?></td>
							<td><a class="button button-small" href="<?php echo esc_url( $url ); ?>">Open</a></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<?php
	}
}
`;

export const TPL_ADMIN_CSS = `.rolepod-custom-overview td code{font-size:12px;color:#555;background:#f5f5f5;padding:2px 6px;border-radius:3px;}
.rolepod-custom-task .form-table th{width:200px;}`;

export const TPL_README = `=== Rolepod Custom ===
Author: nuttaruj
Tags: ai, custom, scaffold
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: ${ROLEPOD_CUSTOM_VERSION}
License: MIT

Per-site bespoke features scaffolded by the rolepod-wplab AI bridge. Each
feature is a "task" — an isolated module with its own settings page,
hooks, and uninstall plumbing.

== Description ==

Tasks land on demand via the \`rolepod_wp_custom_task_scaffold\` MCP tool.
Each task is a single PHP file under \`inc/Modules/<PascalCase>Task.php\`
that extends \`Rolepod\\Custom\\BaseTask\`.

== Why a separate plugin? ==

Lifecycle independence from the rolepod-wp AI bridge:

- Deactivating rolepod-wp does NOT remove your custom features.
- Updating rolepod-wp does NOT touch your task code.
- Uninstalling rolepod-custom cleanly removes ALL rolepod_custom_* options
  via the catch-all uninstall.php.

== Changelog ==

= ${ROLEPOD_CUSTOM_VERSION} =
* Initial release. Scaffolded by rolepod-wplab.
`;

/** Convert a task slug to PascalCase Task class name. e.g. contact-snippet → ContactSnippetTask */
export function taskClassName(taskId: string): string {
  return (
    taskId
      .split(/[-_]/)
      .filter((s) => s.length > 0)
      .map((s) => s[0]!.toUpperCase() + s.slice(1).toLowerCase())
      .join("") + "Task"
  );
}

/** Convert a task slug to underscore form for option keys. */
export function taskOptionKeyPart(taskId: string): string {
  return taskId.replace(/-/g, "_");
}

/**
 * Build the PHP source of an individual task module.
 */
export interface TaskScaffoldInput {
  taskId: string;
  title: string;
  description: string;
  settings: Array<{
    key: string;
    type: "text" | "email" | "url" | "number" | "textarea" | "checkbox" | "select";
    label: string;
    default?: string | number | boolean | undefined;
    help?: string | undefined;
    options?: Record<string, string> | undefined;
  }>;
  /**
   * Body of register_hooks() — raw PHP lines. Must check
   * `if ( ! $this->is_enabled() ) return;` first when appropriate.
   * Common pattern: add_shortcode / add_action / add_filter.
   */
  hooksBody: string;
  /** Optional extra methods appended to the class. */
  extraMethods?: string;
}

export function renderTaskModulePhp(input: TaskScaffoldInput): string {
  const className = taskClassName(input.taskId);
  const settingsSchemaLines = input.settings
    .map((s) => {
      const parts: string[] = [];
      parts.push(`'type' => ${phpQuote(s.type)}`);
      parts.push(`'label' => ${phpQuote(s.label)}`);
      if (s.default !== undefined) {
        parts.push(`'default' => ${phpLiteral(s.default)}`);
      }
      if (s.help !== undefined) {
        parts.push(`'help' => ${phpQuote(s.help)}`);
      }
      if (s.options !== undefined) {
        const optEntries = Object.entries(s.options)
          .map(([k, v]) => `${phpQuote(k)} => ${phpQuote(v)}`)
          .join(", ");
        parts.push(`'options' => [${optEntries}]`);
      }
      return `\t\t\t${phpQuote(s.key)} => [${parts.join(", ")}],`;
    })
    .join("\n");

  const extraMethods = input.extraMethods ? `\n${input.extraMethods}\n` : "";

  return `<?php
declare(strict_types=1);

namespace Rolepod\\Custom\\Modules;

use Rolepod\\Custom\\BaseTask;

/**
 * ${escapeBlockComment(input.description)}
 *
 * Scaffolded by rolepod-wplab. Edit via the "Rolepod Custom" admin menu OR
 * by asking the AI to run rolepod_wp_custom_task_update with this task id.
 */
final class ${className} extends BaseTask {

\tpublic function id(): string {
\t\treturn ${phpQuote(input.taskId)};
\t}

\tpublic function title(): string {
\t\treturn ${phpQuote(input.title)};
\t}

\tpublic function description(): string {
\t\treturn ${phpQuote(input.description)};
\t}

\tpublic function settings_schema(): array {
\t\treturn [
${settingsSchemaLines}
\t\t];
\t}

\tpublic function register_hooks(): void {
${indent(input.hooksBody, 2)}
\t}
${extraMethods}}
`;
}

function phpQuote(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function phpLiteral(v: string | number | boolean): string {
  if (typeof v === "string") return phpQuote(v);
  if (typeof v === "number") return String(v);
  return v ? "true" : "false";
}

function indent(s: string, levels: number): string {
  const tabs = "\t".repeat(levels);
  return s
    .split("\n")
    .map((line) => (line.length > 0 ? tabs + line : line))
    .join("\n");
}

function escapeBlockComment(s: string): string {
  return s.replace(/\*\//g, "* /");
}
