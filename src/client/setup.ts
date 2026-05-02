/**
 * CTRFHub — Setup Wizard Alpine Components.
 *
 * Each wizard step has its own Alpine data component registered via
 * `Alpine.data()`. Components are registered on `alpine:init` so they
 * survive HTMX morph-based swaps.
 *
 * @see skills/htmx-alpine-boundary.md — no x-data containing HTMX targets
 */

// ---------------------------------------------------------------------------
// Step 1 — Admin Account (password strength indicator)
// ---------------------------------------------------------------------------

function setupStep1() {
  return {
    password: '',
    submitting: false,
    get strength(): number {
      const pw = this.password as string;
      if (pw.length === 0) return 0;
      if (pw.length < 12) return 1;
      let classes = 1; // base point for meeting 12+ chars
      if (/[A-Z]/.test(pw)) classes++;
      if (/[a-z]/.test(pw)) classes++;
      if (/[0-9]/.test(pw)) classes++;
      if (/[^A-Za-z0-9]/.test(pw)) classes++;
      return Math.min(4, classes);
    },
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Organization (slug auto-generated from name)
// ---------------------------------------------------------------------------

function setupStep2() {
  return {
    orgName: '',
    slug: '',
    submitting: false,
  };
}

// ---------------------------------------------------------------------------
// Step 3 — Project (slug auto-generated from name)
// ---------------------------------------------------------------------------

function setupStep3() {
  return {
    projectName: '',
    slug: '',
    submitting: false,
  };
}

// ---------------------------------------------------------------------------
// Step 4 — CI/CD (token copy, framework selector)
// ---------------------------------------------------------------------------

function setupStep4() {
  return {
    framework: 'github-actions',
    submitting: false,
    copied: false,
    copyToken() {
      const input = document.querySelector('#setup-card input[readonly]') as HTMLInputElement | null;
      if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
          this.copied = true;
          setTimeout(() => { this.copied = false; }, 2000);
        }).catch(() => {
          // Fallback for non-HTTPS contexts
          input.select();
          document.execCommand('copy');
          this.copied = true;
          setTimeout(() => { this.copied = false; }, 2000);
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Register Alpine data components on alpine:init
// ---------------------------------------------------------------------------

document.addEventListener('alpine:init', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Alpine?.data?.('setupStep1', setupStep1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Alpine?.data?.('setupStep2', setupStep2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Alpine?.data?.('setupStep3', setupStep3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).Alpine?.data?.('setupStep4', setupStep4);
});
