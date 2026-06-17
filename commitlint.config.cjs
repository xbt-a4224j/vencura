// Enforce Conventional Commits (feat/fix/chore/docs/test/…) — the type/scope drive semantic-release.
// Relaxed stylistic rules: we write prose bodies and subjects that reference ticket IDs (T-006) and
// "Block 1", so body/footer length caps and subject-case are off. Type validity is still enforced.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'subject-case': [0],
  },
};
