/* WP Autopilot — marketing site shell.
   Injects a consistent nav + footer into every page, wires the mobile menu,
   scroll-reveal, and the contact form. Keeps the HTML pages lean. */
(function () {
  var LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m4.9 4.9 2.8 2.8"/><path d="M2 12h4"/><path d="M19.1 4.9l-2.8 2.8"/><circle cx="12" cy="13" r="4"/><path d="M12 17v5"/></svg>';

  var NAV = ''
    + '<nav class="nav" id="siteNav"><div class="wrap nav-inner">'
    + '  <a class="brand" href="/landing.html"><span class="logo">' + LOGO + '</span> WP Autopilot</a>'
    + '  <div class="nav-links">'
    + '    <a href="/landing.html#features">Features</a>'
    + '    <a href="/services.html">Services</a>'
    + '    <a href="/use-cases.html">Use cases</a>'
    + '    <a href="/pricing.html">Pricing</a>'
    + '    <a href="/contact.html">Contact</a>'
    + '  </div>'
    + '  <div class="nav-cta">'
    + '    <a class="btn btn-ghost" href="/login.html">Sign in</a>'
    + '    <a class="btn btn-primary" href="/login.html#register">Start free</a>'
    + '    <button class="nav-toggle" id="navToggle" aria-label="Menu"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>'
    + '  </div>'
    + '</div></nav>';

  var YEAR = '2026';
  var FOOTER = ''
    + '<footer class="footer"><div class="wrap">'
    + '  <div class="footer-grid">'
    + '    <div>'
    + '      <a class="brand" href="/landing.html"><span class="logo">' + LOGO + '</span> WP Autopilot</a>'
    + '      <p class="about">The 24/7 autonomous SEO content engine for WordPress. Research, write, optimize, publish, track, and refresh — on autopilot.</p>'
    + '    </div>'
    + '    <div><h4>Product</h4><ul>'
    + '      <li><a href="/landing.html#features">Features</a></li>'
    + '      <li><a href="/services.html">Services</a></li>'
    + '      <li><a href="/pricing.html">Pricing</a></li>'
    + '      <li><a href="/login.html#register">Start free</a></li>'
    + '    </ul></div>'
    + '    <div><h4>Company</h4><ul>'
    + '      <li><a href="/use-cases.html">Use cases</a></li>'
    + '      <li><a href="/contact.html">Contact</a></li>'
    + '      <li><a href="/landing.html#faq">FAQ</a></li>'
    + '    </ul></div>'
    + '    <div><h4>Get started</h4><ul>'
    + '      <li><a href="/login.html#register">Create account</a></li>'
    + '      <li><a href="/login.html">Sign in</a></li>'
    + '      <li><a href="/contact.html">Book a demo</a></li>'
    + '    </ul></div>'
    + '  </div>'
    + '  <div class="footer-bottom">'
    + '    <span>© ' + YEAR + ' WP Autopilot. All rights reserved.</span>'
    + '    <span>Built for WordPress · Powered by Ahrefs &amp; AI</span>'
    + '  </div>'
    + '</div></footer>';

  function mount() {
    var navSlot = document.getElementById('site-nav');
    var footSlot = document.getElementById('site-footer');
    if (navSlot) navSlot.outerHTML = NAV;
    if (footSlot) footSlot.outerHTML = FOOTER;

    // Mobile menu toggle
    var nav = document.getElementById('siteNav');
    var toggle = document.getElementById('navToggle');
    if (toggle && nav) toggle.addEventListener('click', function () { nav.classList.toggle('open'); });

    // Scroll reveal
    var els = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && els.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.12 });
      els.forEach(function (el) { io.observe(el); });
    } else {
      els.forEach(function (el) { el.classList.add('in'); });
    }

    // Contact form (mailto fallback — no backend email service configured)
    var form = document.getElementById('contactForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var ok = document.getElementById('contactOk');
        var name = (form.querySelector('[name=name]') || {}).value || '';
        var email = (form.querySelector('[name=email]') || {}).value || '';
        var msg = (form.querySelector('[name=message]') || {}).value || '';
        var subject = encodeURIComponent('WP Autopilot enquiry from ' + name);
        var body = encodeURIComponent('Name: ' + name + '\nEmail: ' + email + '\n\n' + msg);
        window.location.href = 'mailto:hello@wp-autopilot.app?subject=' + subject + '&body=' + body;
        if (ok) ok.classList.add('ok');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
