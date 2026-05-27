import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./zodToJsonSchema.js";
import type { ProdGuard } from "../safety/ProdGuard.js";
import type { TargetRegistry } from "../target/TargetRegistry.js";
import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import {
  wpConnectLocalHandler,
  wpConnectLocalToolDef,
} from "./atomic/wp_connect_local.js";
import {
  wpConnectRestHandler,
  wpConnectRestToolDef,
} from "./atomic/wp_connect_rest.js";
import {
  wpConnectSshHandler,
  wpConnectSshToolDef,
} from "./atomic/wp_connect_ssh.js";
import {
  wpConnectDockerHandler,
  wpConnectDockerToolDef,
} from "./atomic/wp_connect_docker.js";
import {
  wpDisconnectHandler,
  wpDisconnectToolDef,
} from "./atomic/wp_disconnect.js";
import { wpCliRunHandler, wpCliRunToolDef } from "./atomic/wp_cli_run.js";
import {
  wpHealthCheckHandler,
  wpHealthCheckToolDef,
} from "./atomic/wp_health_check.js";
import { wpFileReadHandler, wpFileReadToolDef } from "./atomic/wp_file_read.js";
import {
  wpFileWriteHandler,
  wpFileWriteToolDef,
} from "./atomic/wp_file_write.js";
import { wpPostGetHandler, wpPostGetToolDef } from "./atomic/wp_post_get.js";
import { wpPostListHandler, wpPostListToolDef } from "./atomic/wp_post_list.js";
import {
  wpPostCreateHandler,
  wpPostCreateToolDef,
} from "./atomic/wp_post_create.js";
import {
  wpPostUpdateHandler,
  wpPostUpdateToolDef,
} from "./atomic/wp_post_update.js";
import {
  wpOptionGetHandler,
  wpOptionGetToolDef,
} from "./atomic/wp_option_get.js";
import {
  wpOptionSetHandler,
  wpOptionSetToolDef,
} from "./atomic/wp_option_set.js";
import { wpUserListHandler, wpUserListToolDef } from "./atomic/wp_user_list.js";
import { wpDbQueryHandler, wpDbQueryToolDef } from "./atomic/wp_db_query.js";
import {
  wpRestRequestHandler,
  wpRestRequestToolDef,
} from "./atomic/wp_rest_request.js";
import {
  wpElementorReadHandler,
  wpElementorReadToolDef,
} from "./adapter/wp_elementor_read.js";
import { wpWooReadHandler, wpWooReadToolDef } from "./adapter/wp_woo_read.js";
import { wpAcfReadHandler, wpAcfReadToolDef } from "./adapter/wp_acf_read.js";
import {
  wpMemoryRecallHandler,
  wpMemoryRecallToolDef,
} from "./atomic/wp_memory_recall.js";
import {
  wpMemoryNoteHandler,
  wpMemoryNoteToolDef,
} from "./atomic/wp_memory_note.js";
import {
  wpMemoryListHandler,
  wpMemoryListToolDef,
} from "./atomic/wp_memory_list.js";
import {
  wpExecutePhpHandler,
  wpExecutePhpToolDef,
} from "./companion/wp_execute_php.js";
import {
  wpIntrospectHandler,
  wpIntrospectToolDef,
} from "./companion/wp_introspect.js";
import {
  wpHookStateHandler,
  wpHookStateToolDef,
} from "./companion/wp_hook_state.js";
import {
  wpChangesQueryHandler,
  wpChangesQueryToolDef,
} from "./companion/wp_changes_query.js";
import {
  wpChangesToggleHandler,
  wpChangesToggleToolDef,
} from "./companion/wp_changes_toggle.js";
import {
  wpChangesToggleBulkHandler,
  wpChangesToggleBulkToolDef,
} from "./companion/wp_changes_toggle_bulk.js";
import {
  wpChangesPanicHandler,
  wpChangesPanicToolDef,
} from "./companion/wp_changes_panic.js";
import {
  wpThemeSnapshotHandler,
  wpThemeSnapshotToolDef,
} from "./composite/wp_theme_snapshot.js";
import {
  wpThemeRestoreHandler,
  wpThemeRestoreToolDef,
} from "./composite/wp_theme_restore.js";
import {
  wpChildThemeCreateHandler,
  wpChildThemeCreateToolDef,
} from "./composite/wp_child_theme_create.js";
import {
  wpThemeSwitchSafeHandler,
  wpThemeSwitchSafeToolDef,
} from "./composite/wp_theme_switch_safe.js";
import {
  wpSessionStartHandler,
  wpSessionStartToolDef,
} from "./atomic/wp_session_start.js";
import {
  wpAdminOneTimeLinkHandler,
  wpAdminOneTimeLinkToolDef,
} from "./companion/wp_admin_one_time_link.js";
import {
  wpRecoveryStatusHandler,
  wpRecoveryStatusToolDef,
} from "./companion/wp_recovery_status.js";
import {
  wpRecoveryDisablePluginHandler,
  wpRecoveryDisablePluginToolDef,
} from "./companion/wp_recovery_disable_plugin.js";
import {
  wpRecoveryDisableFileHandler,
  wpRecoveryDisableFileToolDef,
} from "./companion/wp_recovery_disable_file.js";
import {
  wpRecoveryRestoreFileHandler,
  wpRecoveryRestoreFileToolDef,
} from "./companion/wp_recovery_restore_file.js";
import {
  wpRecoveryRestoreSnapshotHandler,
  wpRecoveryRestoreSnapshotToolDef,
} from "./companion/wp_recovery_restore_snapshot.js";
import {
  wpRecoveryListChangesHandler,
  wpRecoveryListChangesToolDef,
} from "./companion/wp_recovery_list_changes.js";
import {
  wpRecoverySafeModeHandler,
  wpRecoverySafeModeToolDef,
} from "./companion/wp_recovery_safe_mode.js";
import {
  wpMenuCreateHandler,
  wpMenuCreateToolDef,
} from "./atomic/wp_menu_create.js";
import {
  wpMenuAddItemHandler,
  wpMenuAddItemToolDef,
} from "./atomic/wp_menu_add_item.js";
import {
  wpMenuAssignHandler,
  wpMenuAssignToolDef,
} from "./atomic/wp_menu_assign.js";
import {
  wpProductCreateHandler,
  wpProductCreateToolDef,
} from "./atomic/wp_product_create.js";
import {
  wpSetFrontPageHandler,
  wpSetFrontPageToolDef,
} from "./atomic/wp_set_front_page.js";
import {
  wpGlobalStylesSetHandler,
  wpGlobalStylesSetToolDef,
} from "./atomic/wp_global_styles_set.js";
import {
  wpCf7FormCreateHandler,
  wpCf7FormCreateToolDef,
} from "./atomic/wp_cf7_form_create.js";
import {
  wpSeoSetHandler,
  wpSeoSetToolDef,
} from "./atomic/wp_seo_set.js";
import {
  wpSiteScaffoldHandler,
  wpSiteScaffoldToolDef,
} from "./composite/wp_site_scaffold.js";
import {
  wpFileDisableHandler,
  wpFileDisableToolDef,
} from "./atomic/wp_file_disable.js";
import {
  wpFileEnableHandler,
  wpFileEnableToolDef,
} from "./atomic/wp_file_enable.js";
import {
  wpConventionsGetHandler,
  wpConventionsGetToolDef,
  wpConventionsSetHandler,
  wpConventionsSetToolDef,
} from "./atomic/wp_conventions.js";
import {
  wpJetengineReadHandler,
  wpJetengineReadToolDef,
} from "./adapter/wp_jetengine_read.js";
import {
  wpJetengineWriteHandler,
  wpJetengineWriteToolDef,
} from "./adapter/wp_jetengine_write.js";
import {
  wpMetaboxReadHandler,
  wpMetaboxReadToolDef,
} from "./adapter/wp_metabox_read.js";
import {
  wpMetaboxWriteHandler,
  wpMetaboxWriteToolDef,
} from "./adapter/wp_metabox_write.js";
import {
  wpPodsReadHandler,
  wpPodsReadToolDef,
} from "./adapter/wp_pods_read.js";
import {
  wpPodsWriteHandler,
  wpPodsWriteToolDef,
} from "./adapter/wp_pods_write.js";
import {
  wpElementorWriteHandler,
  wpElementorWriteToolDef,
} from "./adapter/wp_elementor_write.js";
import {
  wpWooWriteHandler,
  wpWooWriteToolDef,
} from "./adapter/wp_woo_write.js";
import {
  wpAcfWriteHandler,
  wpAcfWriteToolDef,
} from "./adapter/wp_acf_write.js";
import {
  wpBricksReadHandler,
  wpBricksReadToolDef,
} from "./adapter/wp_bricks_read.js";
import {
  wpScaffoldBlockHandler,
  wpScaffoldBlockToolDef,
} from "./composite/wp_scaffold_block.js";
import {
  wpScaffoldPluginHandler,
  wpScaffoldPluginToolDef,
} from "./composite/wp_scaffold_plugin.js";
import {
  wpScaffoldThemeHandler,
  wpScaffoldThemeToolDef,
} from "./composite/wp_scaffold_theme.js";
import {
  wpAuditSecurityHandler,
  wpAuditSecurityToolDef,
} from "./composite/wp_audit_security.js";
import {
  wpMigrateDryrunHandler,
  wpMigrateDryrunToolDef,
} from "./composite/wp_migrate_dryrun.js";
import {
  wpAuditManyHandler,
  wpAuditManyToolDef,
} from "./composite/wp_audit_many.js";
import {
  wpMigrateDataHandler,
  wpMigrateDataToolDef,
} from "./composite/wp_migrate_data.js";
import {
  wpWpmlReadHandler,
  wpWpmlReadToolDef,
} from "./adapter/wp_wpml_read.js";
import {
  wpYoastReadHandler,
  wpYoastReadToolDef,
} from "./adapter/wp_yoast_read.js";
import {
  wpRankMathReadHandler,
  wpRankMathReadToolDef,
} from "./adapter/wp_rankmath_read.js";
// v1.1 — Tier A
import {
  wpDiviReadHandler,
  wpDiviReadToolDef,
} from "./adapter/wp_divi_read.js";
import {
  wpDiviWriteHandler,
  wpDiviWriteToolDef,
} from "./adapter/wp_divi_write.js";
import {
  wpOxygenReadHandler,
  wpOxygenReadToolDef,
} from "./adapter/wp_oxygen_read.js";
import {
  wpOxygenWriteHandler,
  wpOxygenWriteToolDef,
} from "./adapter/wp_oxygen_write.js";
import {
  wpBricksWriteHandler,
  wpBricksWriteToolDef,
} from "./adapter/wp_bricks_write.js";
import {
  wpYoastWriteHandler,
  wpYoastWriteToolDef,
} from "./adapter/wp_yoast_write.js";
import {
  wpRankMathWriteHandler,
  wpRankMathWriteToolDef,
} from "./adapter/wp_rankmath_write.js";
import {
  wpWpmlWriteHandler,
  wpWpmlWriteToolDef,
} from "./adapter/wp_wpml_write.js";
// v1.1 — Tier B
import {
  wpFormsReadHandler,
  wpFormsReadToolDef,
} from "./adapter/wp_forms_read.js";
import {
  wpFormsWriteHandler,
  wpFormsWriteToolDef,
} from "./adapter/wp_forms_write.js";
import { wpCronToolHandler, wpCronToolToolDef } from "./atomic/wp_cron_tool.js";
import {
  wpCacheToolHandler,
  wpCacheToolToolDef,
} from "./atomic/wp_cache_tool.js";
import { wpMailTestHandler, wpMailTestToolDef } from "./atomic/wp_mail_test.js";
import { wpCloneHandler, wpCloneToolDef } from "./composite/wp_clone.js";
import {
  wpBackupCreateHandler,
  wpBackupCreateToolDef,
  wpBackupRestoreHandler,
  wpBackupRestoreToolDef,
} from "./composite/wp_backup.js";
// v1.2 — One-click pair
import { wpPairHandler, wpPairToolDef } from "./atomic/wp_pair.js";
// v1.1 — Tier D
import {
  wpUserSessionListHandler,
  wpUserSessionListToolDef,
} from "./atomic/wp_user_session_list.js";
import { wpRestDumpHandler, wpRestDumpToolDef } from "./atomic/wp_rest_dump.js";
import {
  wpScaffoldPatternHandler,
  wpScaffoldPatternToolDef,
} from "./composite/wp_scaffold_pattern.js";
import {
  wpDiagnoseHandler,
  wpDiagnoseToolDef,
} from "./composite/wp_diagnose.js";

type RegisterDeps = {
  registry: TargetRegistry;
  prodGuard: ProdGuard;
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
};

type Handler = (deps: RegisterDeps, raw: unknown) => Promise<unknown>;

const TOOLS: Array<{ def: ToolDef; handler: Handler }> = [
  {
    def: wpConnectLocalToolDef,
    handler: (d, raw) => wpConnectLocalHandler(d.registry, raw),
  },
  {
    def: wpConnectRestToolDef,
    handler: (d, raw) => wpConnectRestHandler(d.registry, raw),
  },
  {
    def: wpConnectSshToolDef,
    handler: (d, raw) => wpConnectSshHandler(d.registry, raw),
  },
  {
    def: wpConnectDockerToolDef,
    handler: (d, raw) => wpConnectDockerHandler(d.registry, raw),
  },
  {
    def: wpDisconnectToolDef,
    handler: (d, raw) => wpDisconnectHandler(d.registry, raw),
  },
  {
    def: wpCliRunToolDef,
    handler: (d, raw) => wpCliRunHandler(d.registry, raw),
  },
  {
    def: wpHealthCheckToolDef,
    handler: (d, raw) => wpHealthCheckHandler(d.registry, raw),
  },
  {
    def: wpFileReadToolDef,
    handler: (d, raw) => wpFileReadHandler(d.registry, raw),
  },
  {
    def: wpFileWriteToolDef,
    handler: (d, raw) => wpFileWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpPostGetToolDef,
    handler: (d, raw) => wpPostGetHandler(d.registry, raw),
  },
  {
    def: wpPostListToolDef,
    handler: (d, raw) => wpPostListHandler(d.registry, raw),
  },
  {
    def: wpPostCreateToolDef,
    handler: (d, raw) => wpPostCreateHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpPostUpdateToolDef,
    handler: (d, raw) => wpPostUpdateHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpOptionGetToolDef,
    handler: (d, raw) => wpOptionGetHandler(d.registry, raw),
  },
  {
    def: wpOptionSetToolDef,
    handler: (d, raw) => wpOptionSetHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpUserListToolDef,
    handler: (d, raw) => wpUserListHandler(d.registry, raw),
  },
  {
    def: wpDbQueryToolDef,
    handler: (d, raw) => wpDbQueryHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpRestRequestToolDef,
    handler: (d, raw) => wpRestRequestHandler(d.registry, raw),
  },
  {
    def: wpElementorReadToolDef,
    handler: (d, raw) => wpElementorReadHandler(d.registry, raw),
  },
  {
    def: wpWooReadToolDef,
    handler: (d, raw) => wpWooReadHandler(d.registry, raw),
  },
  {
    def: wpAcfReadToolDef,
    handler: (d, raw) => wpAcfReadHandler(d.registry, raw),
  },
  {
    def: wpMemoryRecallToolDef,
    handler: (d, raw) => wpMemoryRecallHandler(d.registry, raw),
  },
  {
    def: wpMemoryNoteToolDef,
    handler: (d, raw) => wpMemoryNoteHandler(d.registry, raw),
  },
  {
    def: wpMemoryListToolDef,
    handler: (d, raw) => wpMemoryListHandler(d.registry, raw),
  },
  {
    def: wpExecutePhpToolDef,
    handler: (d, raw) => wpExecutePhpHandler(d.registry, raw),
  },
  {
    def: wpIntrospectToolDef,
    handler: (d, raw) => wpIntrospectHandler(d.registry, raw),
  },
  {
    def: wpHookStateToolDef,
    handler: (d, raw) => wpHookStateHandler(d.registry, raw),
  },
  {
    def: wpChangesQueryToolDef,
    handler: (d, raw) => wpChangesQueryHandler(d.registry, raw),
  },
  {
    def: wpChangesToggleToolDef,
    handler: (d, raw) => wpChangesToggleHandler(d.registry, raw),
  },
  {
    def: wpChangesToggleBulkToolDef,
    handler: (d, raw) => wpChangesToggleBulkHandler(d.registry, raw),
  },
  {
    def: wpChangesPanicToolDef,
    handler: (d, raw) => wpChangesPanicHandler(d.registry, raw),
  },
  {
    def: wpThemeSnapshotToolDef,
    handler: (d, raw) => wpThemeSnapshotHandler(d.registry, raw),
  },
  {
    def: wpThemeRestoreToolDef,
    handler: (d, raw) => wpThemeRestoreHandler(d.registry, raw),
  },
  {
    def: wpChildThemeCreateToolDef,
    handler: (d, raw) => wpChildThemeCreateHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpThemeSwitchSafeToolDef,
    handler: (d, raw) => wpThemeSwitchSafeHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpSessionStartToolDef,
    handler: (d, raw) => wpSessionStartHandler(d.registry, raw),
  },
  {
    def: wpAdminOneTimeLinkToolDef,
    handler: (d, raw) => wpAdminOneTimeLinkHandler(d.registry, raw),
  },
  {
    def: wpRecoveryStatusToolDef,
    handler: (d, raw) => wpRecoveryStatusHandler(d.registry, raw),
  },
  {
    def: wpRecoveryDisablePluginToolDef,
    handler: (d, raw) => wpRecoveryDisablePluginHandler(d.registry, raw),
  },
  {
    def: wpRecoveryDisableFileToolDef,
    handler: (d, raw) => wpRecoveryDisableFileHandler(d.registry, raw),
  },
  {
    def: wpRecoveryRestoreFileToolDef,
    handler: (d, raw) => wpRecoveryRestoreFileHandler(d.registry, raw),
  },
  {
    def: wpRecoveryRestoreSnapshotToolDef,
    handler: (d, raw) => wpRecoveryRestoreSnapshotHandler(d.registry, raw),
  },
  {
    def: wpRecoveryListChangesToolDef,
    handler: (d, raw) => wpRecoveryListChangesHandler(d.registry, raw),
  },
  {
    def: wpRecoverySafeModeToolDef,
    handler: (d, raw) => wpRecoverySafeModeHandler(d.registry, raw),
  },
  {
    def: wpMenuCreateToolDef,
    handler: (d, raw) => wpMenuCreateHandler(d.registry, raw),
  },
  {
    def: wpMenuAddItemToolDef,
    handler: (d, raw) => wpMenuAddItemHandler(d.registry, raw),
  },
  {
    def: wpMenuAssignToolDef,
    handler: (d, raw) => wpMenuAssignHandler(d.registry, raw),
  },
  {
    def: wpProductCreateToolDef,
    handler: (d, raw) => wpProductCreateHandler(d.registry, raw),
  },
  {
    def: wpSetFrontPageToolDef,
    handler: (d, raw) => wpSetFrontPageHandler(d.registry, raw),
  },
  {
    def: wpGlobalStylesSetToolDef,
    handler: (d, raw) => wpGlobalStylesSetHandler(d.registry, raw),
  },
  {
    def: wpCf7FormCreateToolDef,
    handler: (d, raw) => wpCf7FormCreateHandler(d.registry, raw),
  },
  {
    def: wpSeoSetToolDef,
    handler: (d, raw) => wpSeoSetHandler(d.registry, raw),
  },
  {
    def: wpSiteScaffoldToolDef,
    handler: (d, raw) => wpSiteScaffoldHandler(d.registry, raw),
  },
  {
    def: wpFileDisableToolDef,
    handler: (d, raw) => wpFileDisableHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpFileEnableToolDef,
    handler: (d, raw) => wpFileEnableHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpConventionsGetToolDef,
    handler: (d, raw) => wpConventionsGetHandler(d.registry, raw),
  },
  {
    def: wpConventionsSetToolDef,
    handler: (d, raw) => wpConventionsSetHandler(d.registry, raw),
  },
  {
    def: wpJetengineReadToolDef,
    handler: (d, raw) => wpJetengineReadHandler(d.registry, raw),
  },
  {
    def: wpJetengineWriteToolDef,
    handler: (d, raw) => wpJetengineWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpMetaboxReadToolDef,
    handler: (d, raw) => wpMetaboxReadHandler(d.registry, raw),
  },
  {
    def: wpMetaboxWriteToolDef,
    handler: (d, raw) => wpMetaboxWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpPodsReadToolDef,
    handler: (d, raw) => wpPodsReadHandler(d.registry, raw),
  },
  {
    def: wpPodsWriteToolDef,
    handler: (d, raw) => wpPodsWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpElementorWriteToolDef,
    handler: (d, raw) => wpElementorWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpWooWriteToolDef,
    handler: (d, raw) => wpWooWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpAcfWriteToolDef,
    handler: (d, raw) => wpAcfWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpBricksReadToolDef,
    handler: (d, raw) => wpBricksReadHandler(d.registry, raw),
  },
  {
    def: wpScaffoldBlockToolDef,
    handler: (d, raw) => wpScaffoldBlockHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpScaffoldPluginToolDef,
    handler: (d, raw) => wpScaffoldPluginHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpScaffoldThemeToolDef,
    handler: (d, raw) => wpScaffoldThemeHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpAuditSecurityToolDef,
    handler: (d, raw) => wpAuditSecurityHandler(d.registry, raw),
  },
  {
    def: wpMigrateDryrunToolDef,
    handler: (d, raw) => wpMigrateDryrunHandler(d.registry, raw),
  },
  {
    def: wpAuditManyToolDef,
    handler: (d, raw) => wpAuditManyHandler(d.registry, raw),
  },
  {
    def: wpMigrateDataToolDef,
    handler: (d, raw) => wpMigrateDataHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpWpmlReadToolDef,
    handler: (d, raw) => wpWpmlReadHandler(d.registry, raw),
  },
  {
    def: wpYoastReadToolDef,
    handler: (d, raw) => wpYoastReadHandler(d.registry, raw),
  },
  {
    def: wpRankMathReadToolDef,
    handler: (d, raw) => wpRankMathReadHandler(d.registry, raw),
  },
  // v1.1 — Tier A
  {
    def: wpDiviReadToolDef,
    handler: (d, raw) => wpDiviReadHandler(d.registry, raw),
  },
  {
    def: wpDiviWriteToolDef,
    handler: (d, raw) => wpDiviWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpOxygenReadToolDef,
    handler: (d, raw) => wpOxygenReadHandler(d.registry, raw),
  },
  {
    def: wpOxygenWriteToolDef,
    handler: (d, raw) => wpOxygenWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpBricksWriteToolDef,
    handler: (d, raw) => wpBricksWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpYoastWriteToolDef,
    handler: (d, raw) => wpYoastWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpRankMathWriteToolDef,
    handler: (d, raw) => wpRankMathWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpWpmlWriteToolDef,
    handler: (d, raw) => wpWpmlWriteHandler(d.registry, d.prodGuard, raw),
  },
  // v1.1 — Tier B
  {
    def: wpFormsReadToolDef,
    handler: (d, raw) => wpFormsReadHandler(d.registry, raw),
  },
  {
    def: wpFormsWriteToolDef,
    handler: (d, raw) => wpFormsWriteHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpCronToolToolDef,
    handler: (d, raw) => wpCronToolHandler(d.registry, raw),
  },
  {
    def: wpCacheToolToolDef,
    handler: (d, raw) => wpCacheToolHandler(d.registry, raw),
  },
  {
    def: wpMailTestToolDef,
    handler: (d, raw) => wpMailTestHandler(d.registry, raw),
  },
  {
    def: wpCloneToolDef,
    handler: (d, raw) => wpCloneHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpBackupCreateToolDef,
    handler: (d, raw) => wpBackupCreateHandler(d.registry, raw),
  },
  {
    def: wpBackupRestoreToolDef,
    handler: (d, raw) => wpBackupRestoreHandler(d.registry, d.prodGuard, raw),
  },
  // v1.1 — Tier D
  {
    def: wpUserSessionListToolDef,
    handler: (d, raw) => wpUserSessionListHandler(d.registry, raw),
  },
  {
    def: wpRestDumpToolDef,
    handler: (d, raw) => wpRestDumpHandler(d.registry, raw),
  },
  {
    def: wpScaffoldPatternToolDef,
    handler: (d, raw) => wpScaffoldPatternHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpDiagnoseToolDef,
    handler: (d, raw) => wpDiagnoseHandler(d.registry, raw),
  },
  // v1.2 — one-click pair
  { def: wpPairToolDef, handler: (d, raw) => wpPairHandler(d.registry, raw) },
];

export function registerTools(server: Server, deps: RegisterDeps): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ def }) => ({
      name: def.name,
      description: def.description,
      inputSchema: zodToJsonSchema(def.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find(({ def }) => def.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const result = await tool.handler(deps, req.params.arguments ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const wplabErr = err instanceof WplabError ? err.toJSON() : null;
      const message = wplabErr
        ? JSON.stringify({ ok: false, error: wplabErr }, null, 2)
        : `Internal error: ${(err as Error).message}`;
      log.warn("tool call failed", { tool: req.params.name, message });
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });
}
