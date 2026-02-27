#!/usr/bin/env node

const { Command } = require('commander');
const packageJson = require('../package.json');
const cli = require('../src/cli');

const program = new Command();

const L1 = "\x1b[38;2;255;42;169m";
const L2 = "\x1b[38;2;222;61;190m";
const L3 = "\x1b[38;2;189;81;211m";
const L4 = "\x1b[38;2;156;100;232m";
const L5 = "\x1b[38;2;123;120;253m";
const L6 = "\x1b[38;2;43;210;255m";

const C_TITLE = "\x1b[38;2;43;210;255m\x1b[1m";
const C_HEAD = "\x1b[38;2;255;42;169m\x1b[1m";
const C_CMD = "\x1b[38;2;46;213;115m";
const C_PROG = "\x1b[38;2;255;165;2m";
const C_DESC = "\x1b[38;2;223;228;234m";
const DIM = "\x1b[2m\x1b[38;2;119;140;163m";
const NC = "\x1b[0m";

const BANNER = `
${L1}  ██████╗██╗      █████╗ ██╗    ██╗ █████╗ ██████╗ ██╗${NC}
${L2} ██╔════╝██║     ██╔══██╗██║    ██║██╔══██╗██╔══██╗██║${NC}
${L3} ██║     ██║     ███████║██║ █╗ ██║███████║██████╔╝██║${NC}
${L4} ██║     ██║     ██╔══██║██║███╗██║██╔══██║██╔═══╝ ██║${NC}
${L5} ╚██████╗███████╗██║  ██║╚███╔███╔╝██║  ██║██║     ██║${NC}
${L6}  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝     ╚═╝${NC}
 ${DIM}Browser-based OpenAI-compatible AI Gateway  |  Node.js${NC}
`;

const HELP_TEXT = `
${C_TITLE}ClawAPI${NC} ${C_DESC}— Browser-based OpenAI-compatible AI Gateway${NC}
${DIM}Run AI models through the browser. No API keys needed.${NC}

${C_HEAD}Server:${NC}
  ${C_PROG}clawapi ${C_CMD}start              ${C_DESC}Start the server (default port: 8855)${NC}
  ${C_PROG}clawapi ${C_CMD}start --port 8080  ${C_DESC}Start on a custom port${NC}
  ${C_PROG}clawapi ${C_CMD}stop               ${C_DESC}Stop the server${NC}
  ${C_PROG}clawapi ${C_CMD}restart            ${C_DESC}Restart the server${NC}
  ${C_PROG}clawapi ${C_CMD}status             ${C_DESC}Show server + provider status${NC}

${C_HEAD}Providers:${NC}
  ${C_PROG}clawapi ${C_CMD}list               ${C_DESC}List installed providers${NC}
  ${C_PROG}clawapi ${C_CMD}available          ${C_DESC}List all providers in the registry${NC}
  ${C_PROG}clawapi ${C_CMD}add <provider>     ${C_DESC}Install a provider${NC}
  ${C_PROG}clawapi ${C_CMD}rm <provider>      ${C_DESC}Remove an installed provider${NC}
  ${C_PROG}clawapi ${C_CMD}auth <provider>    ${C_DESC}Log in / re-authenticate a provider${NC}

${C_HEAD}Utilities:${NC}
  ${C_PROG}clawapi ${C_CMD}logs               ${C_DESC}Watch server logs (live)${NC}
  ${C_PROG}clawapi ${C_CMD}logs -n 100        ${C_DESC}Show last 100 lines${NC}
  ${C_PROG}clawapi ${C_CMD}picoclaw           ${C_DESC}Print picoclaw config snippet${NC}
  ${C_PROG}clawapi ${C_CMD}help               ${C_DESC}Show this help${NC}

${C_HEAD}Examples:${NC}
  ${C_PROG}clawapi ${C_CMD}add claude         ${C_DESC}Install Claude${NC}
  ${C_PROG}clawapi ${C_CMD}auth claude        ${C_DESC}Log into Claude (opens browser)${NC}
  ${C_PROG}clawapi ${C_CMD}start              ${C_DESC}Start the server${NC}
  ${C_PROG}clawapi ${C_CMD}status             ${C_DESC}Check everything is running${NC}

${C_HEAD}API Usage:${NC}
  ${C_PROG}POST ${C_CMD}http://localhost:8855/v1/chat/completions${NC}
  ${C_PROG}Body:${C_DESC} {"model": "clawapi/claude", "messages": [...]}${NC}
`;

program.helpInformation = function() {
  return BANNER + "\n" + HELP_TEXT;
};

program.name('clawapi').version(packageJson.version);

program.command('add <provider>').action(cli.cmdAdd);
program.command('rm <provider>').action(cli.cmdRm);
program.command('list').action(cli.cmdList);
program.command('available').action(cli.cmdAvailable);
program.command('auth <provider>').action(cli.cmdAuth);
program.command('start').option('-p, --port <number>').action(cli.cmdStart);
program.command('stop').action(cli.cmdStop);
program.command('restart').option('-p, --port <number>').action(cli.cmdRestart);
program.command('status').action(cli.cmdStatus);
program.command('logs').option('-n <number>').action(cli.cmdLogs);
program.command('picoclaw').action(cli.cmdPicoclaw);
program.command('help').action(() => console.log(program.helpInformation()));

if (!process.argv.slice(2).length) {
  console.log(program.helpInformation());
  process.exit(0);
}

if (process.argv[2] !== '--internal-server-run') {
  program.parse();
} else {
  require('../src/cli');
}
