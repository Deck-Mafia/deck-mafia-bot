module.exports = {
  apps: [{
    name: "deck-mafia-bot",
    script: "build/index.js", // Pointing to your build output
    // Default environment (Normal mode)
    env: {
      NODE_ENV: "production",
      DEBUG_MODE: "false"
    },
    // Debug environment
    env_debug: {
      NODE_ENV: "development",
      DEBUG_MODE: "true"
    }
  }]
};
