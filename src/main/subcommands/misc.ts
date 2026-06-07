import { feature } from 'bun:bundle';
import type { Command as CommanderCommand } from '@commander-js/extra-typings';

import { TASK_STATUSES } from '../../utils/tasks.js';
import { getAutoModeEnabledStateIfCached } from '../../utils/permissions/permissionSetup.js';
import { getBaseRenderOptions } from '../../utils/renderOptions.js';
import { validateUuid } from '../../utils/uuid.js';

export function registerMiscSubcommands(program: CommanderCommand): void {

program.command('setup-token').description('Set up a long-lived authentication token (requires Claude subscription)').action(async () => {
  const [{
    setupTokenHandler
  }, {
    createRoot
  }] = await Promise.all([import('../../cli/handlers/util.js'), import('../../ink.js')]);
  const root = await createRoot(getBaseRenderOptions(false));
  await setupTokenHandler(root);
});

// Agents command - list configured agents
program.command('agents').description('List configured agents').option('--setting-sources <sources>', 'Comma-separated list of setting sources to load (user, project, local).').action(async () => {
  const {
    agentsHandler
  } = await import('../../cli/handlers/agents.js');
  await agentsHandler();
  process.exit(0);
});
if (feature('TRANSCRIPT_CLASSIFIER')) {
  // Skip when tengu_auto_mode_config.enabled === 'disabled' (circuit breaker).
  // Reads from disk cache — GrowthBook isn't initialized at registration time.
  if (getAutoModeEnabledStateIfCached() !== 'disabled') {
    const autoModeCmd = program.command('auto-mode').description('Inspect auto mode classifier configuration');
    autoModeCmd.command('defaults').description('Print the default auto mode environment, allow, and deny rules as JSON').action(async () => {
      const {
        autoModeDefaultsHandler
      } = await import('../../cli/handlers/autoMode.js');
      autoModeDefaultsHandler();
      process.exit(0);
    });
    autoModeCmd.command('config').description('Print the effective auto mode config as JSON: your settings where set, defaults otherwise').action(async () => {
      const {
        autoModeConfigHandler
      } = await import('../../cli/handlers/autoMode.js');
      autoModeConfigHandler();
      process.exit(0);
    });
    autoModeCmd.command('critique').description('Get AI feedback on your custom auto mode rules').option('--model <model>', 'Override which model is used').action(async options => {
      const {
        autoModeCritiqueHandler
      } = await import('../../cli/handlers/autoMode.js');
      await autoModeCritiqueHandler(options);
      process.exit();
    });
  }
}

// Remote Control command — connect local environment to claude.ai/code.
// The actual command is intercepted by the fast-path in cli.tsx before
// Commander.js runs, so this registration exists only for help output.
// Always hidden: isBridgeEnabled() at this point (before enableConfigs)
// would throw inside isClaudeAISubscriber → getGlobalConfig and return
// false via the try/catch — but not before paying ~65ms of side effects
// (25ms settings Zod parse + 40ms sync `security` keychain subprocess).
// The dynamic visibility never worked; the command was always hidden.
if (feature('BRIDGE_MODE')) {
  program.command('remote-control', {
    hidden: true
  }).alias('rc').description('Connect your local environment for remote-control sessions via claude.ai/code').action(async () => {
    // Unreachable — cli.tsx fast-path handles this command before main.tsx loads.
    // If somehow reached, delegate to bridgeMain.
    const {
      bridgeMain
    } = await import('../../bridge/bridgeMain.js');
    await bridgeMain(process.argv.slice(3));
  });
}
if (feature('KAIROS')) {
  program.command('assistant [sessionId]').description('Attach the REPL as a client to a running bridge session. Discovers sessions via API if no sessionId given.').action(() => {
    // Argv rewriting above should have consumed `assistant [id]`
    // before commander runs. Reaching here means a root flag came first
    // (e.g. `--debug assistant`) and the position-0 predicate
    // didn't match. Print usage like the ssh stub does.
    process.stderr.write('Usage: claude assistant [sessionId]\n\n' + 'Attach the REPL as a viewer client to a running bridge session.\n' + 'Omit sessionId to discover and pick from available sessions.\n');
    process.exit(1);
  });
}

// Doctor command - check installation health
program.command('doctor').description('Check the health of your Claude Code auto-updater. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.').action(async () => {
  const [{
    doctorHandler
  }, {
    createRoot
  }] = await Promise.all([import('../../cli/handlers/util.js'), import('../../ink.js')]);
  const root = await createRoot(getBaseRenderOptions(false));
  await doctorHandler(root);
});

// claude update
//
// For SemVer-compliant versioning with build metadata (X.X.X+SHA):
// - We perform exact string comparison (including SHA) to detect any change
// - This ensures users always get the latest build, even when only the SHA changes
// - UI shows both versions including build metadata for clarity
program.command('update').alias('upgrade').description('Check for updates and install if available').action(async () => {
  const {
    update
  } = await import('src/cli/update.js');
  await update();
});

// claude up — run the project's CLAUDE.md "# claude up" setup instructions.
if ("external" === 'ant') {
  program.command('up').description('[ANT-ONLY] Initialize or upgrade the local dev environment using the "# claude up" section of the nearest CLAUDE.md').action(async () => {
    const {
      up
    } = await import('src/cli/up.js');
    await up();
  });
}

// claude rollback (ant-only)
// Rolls back to previous releases
if ("external" === 'ant') {
  program.command('rollback [target]').description('[ANT-ONLY] Roll back to a previous release\n\nExamples:\n  claude rollback                                    Go 1 version back from current\n  claude rollback 3                                  Go 3 versions back from current\n  claude rollback 2.0.73-dev.20251217.t190658        Roll back to a specific version').option('-l, --list', 'List recent published versions with ages').option('--dry-run', 'Show what would be installed without installing').option('--safe', 'Roll back to the server-pinned safe version (set by oncall during incidents)').action(async (target?: string, options?: {
    list?: boolean;
    dryRun?: boolean;
    safe?: boolean;
  }) => {
    const {
      rollback
    } = await import('src/cli/rollback.js');
    await rollback(target, options);
  });
}

// claude install
program.command('install [target]').description('Install Claude Code native build. Use [target] to specify version (stable, latest, or specific version)').option('--force', 'Force installation even if already installed').action(async (target: string | undefined, options: {
  force?: boolean;
}) => {
  const {
    installHandler
  } = await import('../../cli/handlers/util.js');
  await installHandler(target, options);
});

// ant-only commands
if ("external" === 'ant') {
  const validateLogId = (value: string) => {
    const maybeSessionId = validateUuid(value);
    if (maybeSessionId) return maybeSessionId;
    return Number(value);
  };
  // claude log
  program.command('log').description('[ANT-ONLY] Manage conversation logs.').argument('[number|sessionId]', 'A number (0, 1, 2, etc.) to display a specific log, or the sesssion ID (uuid) of a log', validateLogId).action(async (logId: string | number | undefined) => {
    const {
      logHandler
    } = await import('../../cli/handlers/ant.js');
    await logHandler(logId);
  });

  // claude error
  program.command('error').description('[ANT-ONLY] View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.').argument('[number]', 'A number (0, 1, 2, etc.) to display a specific log', parseInt).action(async (number: number | undefined) => {
    const {
      errorHandler
    } = await import('../../cli/handlers/ant.js');
    await errorHandler(number);
  });

  // claude export
  program.command('export').description('[ANT-ONLY] Export a conversation to a text file.').usage('<source> <outputFile>').argument('<source>', 'Session ID, log index (0, 1, 2...), or path to a .json/.jsonl log file').argument('<outputFile>', 'Output file path for the exported text').addHelpText('after', `
Examples:
$ claude export 0 conversation.txt                Export conversation at log index 0
$ claude export <uuid> conversation.txt           Export conversation by session ID
$ claude export input.json output.txt             Render JSON log file to text
$ claude export <uuid>.jsonl output.txt           Render JSONL session file to text`).action(async (source: string, outputFile: string) => {
    const {
      exportHandler
    } = await import('../../cli/handlers/ant.js');
    await exportHandler(source, outputFile);
  });
  if ("external" === 'ant') {
    const taskCmd = program.command('task').description('[ANT-ONLY] Manage task list tasks');
    taskCmd.command('create <subject>').description('Create a new task').option('-d, --description <text>', 'Task description').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').action(async (subject: string, opts: {
      description?: string;
      list?: string;
    }) => {
      const {
        taskCreateHandler
      } = await import('../../cli/handlers/ant.js');
      await taskCreateHandler(subject, opts);
    });
    taskCmd.command('list').description('List all tasks').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').option('--pending', 'Show only pending tasks').option('--json', 'Output as JSON').action(async (opts: {
      list?: string;
      pending?: boolean;
      json?: boolean;
    }) => {
      const {
        taskListHandler
      } = await import('../../cli/handlers/ant.js');
      await taskListHandler(opts);
    });
    taskCmd.command('get <id>').description('Get details of a task').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').action(async (id: string, opts: {
      list?: string;
    }) => {
      const {
        taskGetHandler
      } = await import('../../cli/handlers/ant.js');
      await taskGetHandler(id, opts);
    });
    taskCmd.command('update <id>').description('Update a task').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').option('-s, --status <status>', `Set status (${TASK_STATUSES.join(', ')})`).option('--subject <text>', 'Update subject').option('-d, --description <text>', 'Update description').option('--owner <agentId>', 'Set owner').option('--clear-owner', 'Clear owner').action(async (id: string, opts: {
      list?: string;
      status?: string;
      subject?: string;
      description?: string;
      owner?: string;
      clearOwner?: boolean;
    }) => {
      const {
        taskUpdateHandler
      } = await import('../../cli/handlers/ant.js');
      await taskUpdateHandler(id, opts);
    });
    taskCmd.command('dir').description('Show the tasks directory path').option('-l, --list <id>', 'Task list ID (defaults to "tasklist")').action(async (opts: {
      list?: string;
    }) => {
      const {
        taskDirHandler
      } = await import('../../cli/handlers/ant.js');
      await taskDirHandler(opts);
    });
  }

  // claude completion <shell>
  program.command('completion <shell>', {
    hidden: true
  }).description('Generate shell completion script (bash, zsh, or fish)').option('--output <file>', 'Write completion script directly to a file instead of stdout').action(async (shell: string, opts: {
    output?: string;
  }) => {
    const {
      completionHandler
    } = await import('../../cli/handlers/ant.js');
    await completionHandler(shell, opts, program);
  });
}
}
