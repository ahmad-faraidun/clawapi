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
  // chatgpt: {
  //   name: 'chatgpt',
  //   displayName: 'ChatGPT',
  //   vendor: 'OpenAI',
  //   url: 'https://chat.openai.com',
  //   loginUrl: 'https://chat.openai.com/auth/login',
  //   selectors: {
  //     input: '#prompt-textarea',
  //     stop_button: '[aria-label="Stop generating"]',
  //     response: ['.markdown', '.prose']
  //   },
  //   notes: 'Requires OpenAI account.'
  // },
  // gemini: {
  //   name: 'gemini',
  //   displayName: 'Gemini',
  //   vendor: 'Google',
  //   url: 'https://gemini.google.com',
  //   loginUrl: 'https://gemini.google.com/app',
  //   selectors: {
  //     input: '.ql-editor',
  //     stop_button: '[aria-label="Stop generation"]',
  //     response: ['model-response', '.message-content']
  //   },
  //   notes: 'Requires Google account.'
  // }
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
