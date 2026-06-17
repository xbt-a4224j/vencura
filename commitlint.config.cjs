// Enforce Conventional Commits (feat/fix/chore/docs/test/…) — they drive semantic-release.
// We write prose commit bodies; only the header type/scope/subject matters for releases,
// so the body/footer line-length caps are disabled.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
