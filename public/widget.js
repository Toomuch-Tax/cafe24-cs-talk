/*
 * CS-Talk 위젯 로더
 * 쇼핑몰 페이지에 <script src="https://<cs-host>/widget.js" async></script> 한 줄로 삽입한다.
 *
 * 비용 원칙: 버튼만 그린다. 고객이 버튼을 누르기 전에는 iframe·API 호출·DB 기록이 전혀 없다.
 * 방문자 토큰은 쇼핑몰 도메인(1st-party) localStorage 에 보관해 iframe 저장소 정책과 무관하게 대화를 복구한다.
 *
 * src 쿼리:
 *   cid=<Cafe24 앱 client_id>  로그인 회원을 Cafe24 서명 토큰(getEncryptedMemberId)으로 확인할 때 사용
 *   mode=test                  테스트 스킨에만 설치되는 스크립트. 미공개 기능이 켜진다
 *   testskin=<번호>            전체 공개 스크립트가 테스트 스킨 미리보기(/skin-skin<번호>/)에서는 물러나게 한다
 */
(function () {
  if (window.__CS_TALK__) return;

  var script = document.currentScript;
  var SRC = new URL(script ? script.src : "/widget.js", location.href);
  var BASE = SRC.origin;
  var CLIENT_ID = SRC.searchParams.get("cid");
  var MODE = SRC.searchParams.get("mode") || "live";
  var TOKEN_KEY = "cstalk_visitor_token";
  var HAS_INQUIRY_KEY = "cstalk_has_inquiry"; // 문의를 남긴 적이 있는 방문자만 새 답변 배지를 확인한다
  var PREVIEW_KEY = "cstalk_preview"; // 예전 버전이 쓰던 키 (정리용)
  // 위젯에서 로그인·회원가입으로 나간 경우: 돌아온 페이지에서 위젯을 다시 열고 하던 화면을 잇는다 (탭 안에서만, 30분)
  var RESUME_KEY = "cstalk_resume";
  var RESUME_TTL = 30 * 60 * 1000;
  var Z = 2147483000;

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {}
  }
  function load(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  // 예전 버전이 저장해 둔 테스트 플래그 정리 (한 번 테스트한 브라우저에 계속 보이던 문제)
  store(PREVIEW_KEY, null);
  try {
    sessionStorage.removeItem(PREVIEW_KEY);
  } catch (e) {}

  // 예전 '테스트 모드' 스크립트(mode=preview)는 더 이상 쓰지 않는다. 아무것도 그리지 않는다.
  if (MODE === "preview") return;
  var ENV = MODE === "test" ? "test" : "live";

  // 전체 공개 스크립트는 테스트 스킨 미리보기(/skin-skinNN/)에서는 그리지 않는다. 테스트 스크립트가 대신 그린다.
  var TEST_SKIN = SRC.searchParams.get("testskin");
  var skinPath = location.pathname.match(/^\/skin-skin(\d+)(\/|$)/);
  if (ENV === "live" && TEST_SKIN && skinPath && skinPath[1] === TEST_SKIN) return;

  window.__CS_TALK__ = true; // 건너뛰는 스크립트는 표시하지 않는다 (같은 페이지의 다른 스크립트가 그릴 수 있게)

  // 로그인 회원이면 Cafe24 가 서명한 회원 토큰을 받는다. 채팅을 열 때만 호출한다.
  // CAFE24API 는 Cafe24 가 비동기로 심어주므로 최대 3초 기다린다. 비회원이면 에러 → null.
  function memberToken(cb) {
    if (!CLIENT_ID) return cb(null);
    var waited = 0;
    (function tryCall() {
      var api = window.CAFE24API;
      if (!api || typeof api.getEncryptedMemberId !== "function") {
        if ((waited += 200) > 3000) return cb(null);
        return setTimeout(tryCall, 200);
      }
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; cb(null); }
      }, 3000);
      try {
        api.getEncryptedMemberId(CLIENT_ID, function (err, res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cb(!err && res && typeof res.member_id === "string" ? res.member_id : null);
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); cb(null); }
      }
    })();
  }

  // Cafe24 템플릿에서 window.CS_TALK_MEMBER_ID = '{$member_id}' 처럼 넘길 수 있다.
  // 참고용 힌트일 뿐이며 서버는 이 값을 권한 근거로 쓰지 않는다.
  function memberIdHint() {
    var v = window.CS_TALK_MEMBER_ID;
    return typeof v === "string" && v && v.indexOf("{$") !== 0 ? v : null;
  }

  // 상품 상세에서 연 경우 화면에 보이는 상품명 (문의 양식 상품명 칸을 미리 채운다).
  // 주소의 영문 이름은 등록 때 정해져 상품명을 바꿔도 그대로라 쓰지 않는다. 목록 화면은 og:type 이 product.group 이다.
  function productName() {
    var type = document.querySelector('meta[property="og:type"]');
    if (!type || type.getAttribute("content") !== "product") return null;
    var v = typeof window.product_name === "string" ? window.product_name : "";
    if (!v) {
      var og = document.querySelector('meta[property="og:title"]');
      v = og ? (og.getAttribute("content") || "").replace(/\s+-\s+[^-]*$/, "") : "";
    }
    v = v.trim();
    return v ? v.slice(0, 120) : null;
  }

  // L4 Spatial · W1 Frost: 런처는 짙은 잉크 원, 새 답변은 코발트 신호, 창은 흰 패널
  // 모션: 런처가 패널로 늘어나는 모프, 아이콘 회전 교차, 배지 팝 + 리플
  var css =
    ".cstalk-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;" +
    "background:oklch(19% 0.014 265);color:oklch(99% 0 0);cursor:pointer;z-index:" + Z + ";" +
    "box-shadow:0 0 0 1px oklch(0% 0 0 / .04),0 12px 32px -8px oklch(25% 0.03 265 / .35);" +
    "display:flex;align-items:center;justify-content:center;transition:transform .16s cubic-bezier(.23,1,.32,1)}" +
    "@media (hover:hover) and (pointer:fine){.cstalk-btn:hover{transform:scale(1.05)}}.cstalk-btn:active{transform:scale(.97)}" +
    ".cstalk-btn:focus-visible{outline:2px solid oklch(58% 0.2 266);outline-offset:3px}" +
    ".cstalk-ic{position:absolute;transition:opacity .2s cubic-bezier(.23,1,.32,1),transform .2s cubic-bezier(.23,1,.32,1)}" +
    ".cstalk-ic-x{opacity:0;transform:rotate(90deg) scale(.6)}" +
    ".cstalk-open .cstalk-ic-chat{opacity:0;transform:rotate(-90deg) scale(.6)}.cstalk-open .cstalk-ic-x{opacity:1;transform:none}" +
    ".cstalk-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;" +
    "background:oklch(54% 0.2 266);color:oklch(99% 0 0);box-shadow:0 0 0 2px oklch(100% 0 0),0 0 10px oklch(58% 0.2 266 / .5);" +
    "font:700 11px/20px -apple-system,system-ui,sans-serif;display:none}" +
    ".cstalk-ripple{position:absolute;inset:0;border-radius:50%;border:1.5px solid oklch(58% 0.2 266);opacity:0;pointer-events:none}" +
    ".cstalk-frame{position:fixed;right:20px;bottom:88px;width:380px;height:min(640px,calc(100vh - 120px));" +
    "border:0;border-radius:22px;background:oklch(99.4% 0.003 260);z-index:" + Z + ";display:none;transform-origin:0 0;" +
    "box-shadow:0 0 0 1px oklch(25% 0.03 265 / .08),0 40px 80px -24px oklch(25% 0.03 265 / .35)}" +
    "@media (max-width:480px){.cstalk-frame{inset:0;width:100%;height:100%;border-radius:0}" +
    ".cstalk-open .cstalk-btn{display:none}}" +
    "@media (prefers-reduced-motion:reduce){.cstalk-btn,.cstalk-ic{transition:none}}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.className = "cstalk-root";
  var btn = document.createElement("button");
  btn.className = "cstalk-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "고객센터 채팅 열기");
  btn.innerHTML =
    '<svg class="cstalk-ic cstalk-ic-chat" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>' +
    '<svg class="cstalk-ic cstalk-ic-x" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
    '<span class="cstalk-ripple"></span><span class="cstalk-badge"></span>';
  root.appendChild(btn);
  document.body.appendChild(root);
  var badge = btn.querySelector(".cstalk-badge");
  var ripple = btn.querySelector(".cstalk-ripple");

  // ---- 모션 ----
  var LAUNCHER_BG = "oklch(19% 0.014 265)";
  var PANEL_BG = "oklch(99.4% 0.003 260)";
  var EASE_OUT = "cubic-bezier(.23,1,.32,1)";
  var reduceMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() {
    return !!(reduceMq && reduceMq.matches);
  }
  // 스프링(살짝 튕김)을 CSS linear() 이징으로 만든다. 지원하지 않는 브라우저는 ease-out.
  var SPRING = (function () {
    var x = 0, v = 0, t = 0, dt = 1 / 120, pts = [];
    while (t < 2) {
      v += (-240 * (x - 1) - 24 * v) * dt;
      x += v * dt;
      t += dt;
      pts.push(x);
      if (Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
    }
    var step = Math.max(1, Math.floor(pts.length / 40)), out = ["0"];
    for (var i = step; i < pts.length - 1; i += step) out.push(pts[i].toFixed(4));
    out.push("1");
    var ok = window.CSS && CSS.supports && CSS.supports("animation-timing-function", "linear(0, 1)");
    return { easing: ok ? "linear(" + out.join(",") + ")" : EASE_OUT, duration: ok ? Math.round(t * 1000) : 320 };
  })();
  function stopFrameAnims() {
    if (frame && frame.getAnimations) frame.getAnimations().forEach(function (a) { a.cancel(); });
  }
  // 런처 원 → 패널 사각형으로 가는 transform (FLIP). 패널 쪽 좌표계로 런처 위치·크기를 계산한다.
  function launcherShape(l) {
    var p = frame.getBoundingClientRect();
    var sx = l.width / p.width, sy = l.height / p.height;
    return {
      transform: "translate(" + (l.left - p.left) + "px," + (l.top - p.top) + "px) scale(" + sx + "," + sy + ")",
      borderRadius: l.width / 2 / sx + "px / " + l.height / 2 / sy + "px",
    };
  }
  function animateOpen(launcherRect) {
    if (!frame.animate) return;
    stopFrameAnims();
    if (reduced()) {
      frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease" });
      return;
    }
    var from = launcherShape(launcherRect);
    var radius = getComputedStyle(frame).borderRadius;
    frame.animate([{ backgroundColor: LAUNCHER_BG }, { backgroundColor: PANEL_BG }], { duration: 260, easing: EASE_OUT });
    frame.animate(
      [{ transform: from.transform, borderRadius: from.borderRadius }, { transform: "none", borderRadius: radius }],
      { duration: SPRING.duration, easing: SPRING.easing },
    );
  }
  function animateClose(done) {
    if (!frame.animate) return done();
    stopFrameAnims();
    if (reduced()) {
      frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease", fill: "forwards" }).onfinish = done;
      return;
    }
    var to = launcherShape(btn.getBoundingClientRect());
    var radius = getComputedStyle(frame).borderRadius;
    frame.animate(
      [{ backgroundColor: PANEL_BG }, { backgroundColor: LAUNCHER_BG, offset: 0.7 }, { backgroundColor: LAUNCHER_BG }],
      { duration: 260, easing: EASE_OUT, fill: "forwards" },
    );
    frame.animate(
      [{ transform: "none", borderRadius: radius }, { transform: to.transform, borderRadius: to.borderRadius }],
      { duration: 260, easing: EASE_OUT, fill: "forwards" },
    ).onfinish = done;
  }
  function popBadge() {
    if (!badge.animate) return;
    if (reduced()) {
      badge.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      return;
    }
    badge.animate(
      [{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "scale(1.12)", offset: 0.6 }, { transform: "scale(1)" }],
      { duration: 320, easing: EASE_OUT },
    );
    ripple.animate([{ opacity: 0.6, transform: "scale(1)" }, { opacity: 0, transform: "scale(2.4)" }], {
      duration: 900,
      delay: 120,
      easing: EASE_OUT,
    });
  }

  var frame = null;
  var isOpen = false;
  var memberTokenPromise = null; // 첫 클릭 때 한 번만 요청

  function post(msg) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, BASE);
  }

  function setOpen(open) {
    if (open === isOpen) return;
    isOpen = open;
    var launcherRect = btn.getBoundingClientRect(); // 모바일은 열리면 런처가 숨으므로 먼저 잰다
    root.classList.toggle("cstalk-open", open);
    if (frame) {
      if (open) {
        frame.style.display = "block";
        animateOpen(launcherRect);
      } else {
        animateClose(function () {
          if (isOpen) return; // 닫히는 도중 다시 열었으면 그대로 둔다
          frame.style.display = "none";
          stopFrameAnims();
        });
      }
    }
    btn.setAttribute("aria-label", open ? "고객센터 채팅 닫기" : "고객센터 채팅 열기");
    if (open) setBadge(0);
    post({ type: "cstalk:visibility", open: open });
  }

  var badgeCount = 0;
  function setBadge(n) {
    if (n > 0 && badgeCount === 0) popBadge();
    badgeCount = n;
    badge.textContent = n > 9 ? "9+" : String(n);
    badge.style.display = n > 0 ? "block" : "none";
  }

  var resume = null; // 다시 열 때 위젯에 넘길 화면 (cstalk:init)

  function toggle() {
    if (!frame) {
      memberTokenPromise = new Promise(function (resolve) { memberToken(resolve); });
      frame = document.createElement("iframe");
      frame.className = "cstalk-frame";
      frame.title = "고객센터 채팅";
      frame.allow = "clipboard-write";
      frame.src = BASE + "/widget?origin=" + encodeURIComponent(location.origin);
      root.appendChild(frame);
    }
    setOpen(!isOpen);
  }
  btn.addEventListener("click", toggle);

  window.addEventListener("message", function (e) {
    if (e.origin !== BASE || !frame || e.source !== frame.contentWindow) return;
    var d = e.data || {};
    if (d.type === "cstalk:ready") {
      memberTokenPromise.then(function (mt) {
        post({
          type: "cstalk:init",
          token: load(TOKEN_KEY),
          pageUrl: location.href,
          productName: productName(),
          memberIdHint: memberIdHint(),
          memberToken: mt,
          env: ENV,
          open: isOpen,
          resume: resume,
        });
        resume = null;
      });
    } else if (d.type === "cstalk:token") {
      store(TOKEN_KEY, typeof d.token === "string" ? d.token : null);
    } else if (d.type === "cstalk:has_inquiry") {
      store(HAS_INQUIRY_KEY, d.value ? "1" : null);
    } else if (d.type === "cstalk:resume") {
      // 회원가입 화면(/member/…)을 여러 장 거쳐도 남아 있다가, 쇼핑몰 페이지로 돌아오면 쓰고 지운다
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({ at: Date.now(), resume: d.resume || null }));
      } catch (e) {}
    } else if (d.type === "cstalk:close") {
      setOpen(false);
    } else if (d.type === "cstalk:unread") {
      if (!isOpen) setBadge(Number(d.count) || 0);
    }
  });

  // 로그인·회원가입을 마치고 돌아왔으면 위젯을 열어 이어서 하게 한다
  (function () {
    if (/^(\/skin-skin\d+)?\/member\//.test(location.pathname)) return; // 가입·로그인 진행 중
    var saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) || "null");
      sessionStorage.removeItem(RESUME_KEY);
    } catch (e) {}
    if (!saved || !(Date.now() - saved.at < RESUME_TTL)) return;
    resume = saved.resume;
    toggle();
  })();

  // 다시 방문한 고객: 새 답변이 있으면 버튼에 표시 (문의 이력이 없으면 요청하지 않음)
  var savedToken = load(TOKEN_KEY);
  if (savedToken && load(HAS_INQUIRY_KEY) === "1" && window.fetch) {
    fetch(BASE + "/api/widget/unread", { headers: { authorization: "Bearer " + savedToken }, credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && !isOpen) setBadge(Number(d.count) || 0); })
      .catch(function () {});
  }
})();
