const REGISTRY = {
  claude: {
    name: 'claude',
    displayName: 'Claude',
    vendor: 'Anthropic',
    url: 'https://claude.ai/new',
    loginUrl: 'https://claude.ai/login',
    selectors: {
      input: '.ProseMirror',
      stop_button: '[aria-label="Stop"]',
      response: [
        '.font-claude-message',
        '.font-claude-response-body',
        '.font-claude-response',
        '[class*="message"]',
        '[data-is-streaming="false"]'
      ]
    },
    notes: 'Free tier available. Login via email or Google.'
  }
};

function get(name) {
  return REGISTRY[name];
}

function allNames() {
  return Object.keys(REGISTRY);
}

function exists(name) {
  return name in REGISTRY;
}

module.exports = {
  REGISTRY,
  get,
  allNames,
  exists
};
