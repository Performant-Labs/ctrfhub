import time, os, json

OUT = "/Users/andreangelantoni-on-vm/Projects/ctrfhub/docs/planning/comparisons/ui-audit"
os.makedirs(OUT, exist_ok=True)

# ── 1. Login page ──────────────────────────────────────────────────────────────
ensure_real_tab()
goto_url("https://demo.reportportal.io/ui/#login")
wait_for_load()
time.sleep(2)
capture_screenshot(f"{OUT}/rp_01_login.png")
print("=== 1. LOGIN PAGE ===")
print("title:", js("return document.title"))

# Fill login form via React-friendly input events
js("""
  var u = document.querySelector('input[placeholder*="ogin"],input[type=text],input[name=login]');
  var p = document.querySelector('input[type=password]');
  function setVal(el, val) {
    var nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    nativeInput.set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setVal(u, 'superadmin');
  setVal(p, 'erebus');
""")
time.sleep(0.5)
js("document.querySelector('button[type=submit]').click()")
time.sleep(4)
wait_for_load()
time.sleep(2)

# ── 2. Dashboard ───────────────────────────────────────────────────────────────
capture_screenshot(f"{OUT}/rp_02_dashboard.png")
print("\n=== 2. DASHBOARD ===")
print("url:", js("return location.href"))
print("title:", js("return document.title"))
nav = js("return Array.from(document.querySelectorAll('nav a, [class*=sidebar] a, [class*=nav] a')).map(a => a.innerText.trim()).filter(t => t.length).slice(0,20)")
print("nav items:", nav)
widgets = js("return Array.from(document.querySelectorAll('[class*=widget],[class*=dashboard-item],[class*=chart]')).map(e => e.className.split(' ')[0] + ': ' + (e.querySelector('h1,h2,h3,h4,[class*=title]')?.innerText?.trim() || '')).slice(0,15)")
print("widgets:", widgets)

# ── 3. Navigate to a project's launches ───────────────────────────────────────
# Find any project/launch link
launch_links = js("return Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.match(/ui\\/.*\\/launches/)).map(a => ({text: a.innerText.trim(), href: a.href})).slice(0,5)")
print("\n=== LAUNCH LINKS FOUND ===", launch_links)

if launch_links:
    goto_url(launch_links[0]["href"])
else:
    # Try direct path — superadmin can access default project
    goto_url("https://demo.reportportal.io/ui/#superadmin_personal/launches/all")

wait_for_load()
time.sleep(3)
capture_screenshot(f"{OUT}/rp_03_launches_list.png")
print("\n=== 3. LAUNCHES LIST ===")
print("url:", js("return location.href"))
print("title:", js("return document.title"))
cols = js("return Array.from(document.querySelectorAll('th,[class*=col-header],[class*=header-cell]')).map(e => e.innerText.trim()).filter(t=>t)")
print("columns:", cols)
launch_rows = js("return Array.from(document.querySelectorAll('[class*=launch-name],[class*=launch-item],[class*=grid-row]')).map(e => e.innerText?.substring(0,100).trim()).filter(t=>t).slice(0,5)")
print("sample rows:", launch_rows)
filters = js("return Array.from(document.querySelectorAll('[class*=filter],[class*=search],[placeholder]')).map(e => e.placeholder || e.className.split(' ')[0]).filter(t=>t).slice(0,10)")
print("filters/search:", filters)

# ── 4. Open a launch ──────────────────────────────────────────────────────────
launch_link = js("return document.querySelector('[class*=launch-name] a, [class*=launchName] a, [class*=grid-row] a')?.href")
print("\nFirst launch link:", launch_link)
if launch_link:
    goto_url(launch_link)
    wait_for_load()
    time.sleep(3)
    capture_screenshot(f"{OUT}/rp_04_launch_detail.png")
    print("\n=== 4. LAUNCH DETAIL ===")
    print("url:", js("return location.href"))
    stats = js("return Array.from(document.querySelectorAll('[class*=statistic],[class*=counter],[class*=passed],[class*=failed],[class*=skipped]')).map(e => e.innerText?.trim()).filter(t=>t).slice(0,20)")
    print("stats:", stats)
    suite_items = js("return Array.from(document.querySelectorAll('[class*=test-item],[class*=suite],[class*=item-name]')).map(e => e.innerText?.substring(0,80).trim()).filter(t=>t).slice(0,10)")
    print("test suites/items:", suite_items)

    # ── 5. Open a failing test item ────────────────────────────────────────────
    failed_link = js("return document.querySelector('[class*=failed] a, [class*=FAILED] a, [class*=status-failed] a')?.href")
    print("\nFailed item link:", failed_link)
    if failed_link:
        goto_url(failed_link)
        wait_for_load()
        time.sleep(3)
        capture_screenshot(f"{OUT}/rp_05_test_detail.png")
        print("\n=== 5. TEST ITEM DETAIL ===")
        print("url:", js("return location.href"))
        error_msg = js("return document.querySelector('[class*=error],[class*=message],[class*=log-message]')?.innerText?.substring(0,200)")
        print("error message:", error_msg)
        defect_ui = js("return Array.from(document.querySelectorAll('[class*=defect],[class*=issue-type],[class*=make-decision],[class*=analyze]')).map(e => e.innerText?.trim() || e.className).filter(t=>t).slice(0,10)")
        print("defect/AI UI elements:", defect_ui)
        ai_ui = js("return Array.from(document.querySelectorAll('[class*=auto-analyze],[class*=aa-],[class*=analyzer],[class*=suggest]')).map(e => e.innerText?.trim() || e.className).filter(t=>t).slice(0,10)")
        print("auto-analyzer UI:", ai_ui)

print("\n=== AUDIT COMPLETE ===")
