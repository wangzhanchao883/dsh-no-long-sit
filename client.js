/* dsh-no-long-sit client bundle — 浏览器半端（猫猫浮层 + 提醒/案例/总结三窗 + 设置卡片）
 *
 * 以经典脚本形式注册到 window.__ModuleLoader__（id 必须等于包名）；
 * 工厂内用 require 取 React，**不能用 JSX、不能用 import**（无构建步骤），一律 React.createElement。
 * 挂载点：shell.overlay（整页浮层，DSH 里唯一的全局 overlay 位）——根元素必须是浮层直接子节点，
 * 且浮层 CSS 是 pointer-events:none + 子元素 auto，所以每块 UI 自己就是子节点，不要包一层全屏 wrapper。
 * 数据来源：host 半身的 /dsh-no-long-sit/{state,cases,choice}（同源 fetch，自带会话 cookie）。
 */
window.__ModuleLoader__.load({
  id: "dsh-no-long-sit",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const API = "/dsh-no-long-sit";
    const NS = "dsh-no-long-sit";
    const POLL_MS = 3000;
    const PHASE_TEXT = {
      focus: "专注中",
      break: "该起来活动了",
      awaitReturn: "回来干活",
      stopped: "已结束",
    };
    const GRADE_TEXT = { good: "好", mid: "中", bad: "差" };
    const GRADE_CLASS = { good: "nls-grade-good", mid: "nls-grade-mid", bad: "nls-grade-bad" };

    const CSS = `
.nls-card{box-sizing:border-box;font-family:inherit;color:#1F4E79;background:linear-gradient(180deg,#F7FBFF 0%,#FFFFFF 72%);border:1px solid #CFE6FF;border-radius:16px;box-shadow:0 14px 36px rgba(74,144,217,.20)}
.nls-pet{position:fixed;width:104px;z-index:21;pointer-events:auto;user-select:none;cursor:grab;touch-action:none;filter:drop-shadow(0 8px 16px rgba(74,144,217,.28))}
.nls-pet-dragging{cursor:grabbing}
.nls-pet img{width:100%;display:block;pointer-events:none}
.nls-pet-badge{margin-top:-14px;text-align:center;font-size:12px;line-height:18px;color:#2F6FAE;background:#E8F4FF;border:1px solid #CFE6FF;border-radius:10px;padding:1px 6px;display:block}
.nls-pet-pop{position:fixed;width:208px;padding:12px;z-index:22;pointer-events:auto;font-size:13px}
.nls-mask{position:fixed;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;background:rgba(214,235,255,.42);backdrop-filter:blur(2px)}
.nls-mask-reminder{z-index:30}
.nls-mask-cases{z-index:40;background:rgba(214,235,255,.50)}
.nls-mask-summary{z-index:50;background:rgba(214,235,255,.55)}
.nls-win{width:440px;padding:22px 24px 18px;pointer-events:auto}
.nls-reminder{width:460px;padding:24px 26px 20px;border-width:2px;border-color:#B7DBFF;box-shadow:0 24px 64px rgba(74,144,217,.38)}
.nls-win-wide{width:520px;max-height:78vh;overflow:auto}
.nls-head{display:flex;align-items:flex-start;gap:12px}
.nls-head img{width:76px;flex:0 0 76px}
.nls-title{font-size:16px;font-weight:700;color:#1F4E79;margin:0 0 4px}
.nls-sub{font-size:13px;color:#3C6E9B;margin:0}
.nls-big{font-size:30px;font-weight:700;letter-spacing:1px;color:#2F6FAE;font-variant-numeric:tabular-nums}
.nls-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
.nls-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
.nls-btn{border-radius:10px;border:1px solid #CFE6FF;background:#FFFFFF;color:#2F6FAE;font-size:13px;padding:7px 14px;cursor:pointer;font-family:inherit}
.nls-btn:hover{background:#F2F9FF}
.nls-btn-primary{background:#4A90D9;border-color:#4A90D9;color:#FFFFFF}
.nls-btn-primary:hover{background:#3D81C6}
.nls-btn-ghost{border-color:transparent;background:transparent;color:#6B8CB0}
.nls-hint{margin-top:10px;font-size:12px;color:#6B8CB0}
.nls-warn{margin-top:10px;font-size:12px;color:#C2603A;background:#FFF3EC;border:1px solid #FFD9C6;border-radius:10px;padding:7px 10px}
.nls-sec{margin-top:14px}
.nls-sec-title{font-size:13px;font-weight:700;color:#1F4E79;margin:0 0 6px;display:flex;align-items:center;gap:6px}
.nls-tag{font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:#E8F4FF;color:#2F6FAE;border:1px solid #CFE6FF}
.nls-case{border:1px solid #DCEBFA;border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#FBFDFF}
.nls-case-title{font-size:13px;font-weight:700;color:#1F4E79;margin:0 0 4px}
.nls-case-fact{font-size:13px;line-height:20px;color:#33556F;margin:0}
.nls-case-meta{font-size:11px;color:#7B9CBC;margin-top:6px}
.nls-case-meta a{color:#4A90D9;text-decoration:none}
.nls-case-meta a:hover{text-decoration:underline}
.nls-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
.nls-stat{background:#F5FAFF;border:1px solid #E2EFFB;border-radius:10px;padding:8px 10px}
.nls-stat b{display:block;font-size:19px;color:#2F6FAE;font-variant-numeric:tabular-nums}
.nls-stat span{font-size:12px;color:#6B8CB0}
.nls-grade{display:inline-block;font-size:14px;font-weight:700;border-radius:999px;padding:2px 12px}
.nls-grade-good{background:#E6F7EC;color:#1F7A45;border:1px solid #BFE7CD}
.nls-grade-mid{background:#FFF6E5;color:#9A6B12;border:1px solid #FFE3B0}
.nls-grade-bad{background:#FDECEC;color:#A33A3A;border:1px solid #F6C9C9}
.nls-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin-top:8px}
.nls-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#3C6E9B}
.nls-field input[type=text],.nls-field input[type=number]{font-family:inherit;font-size:13px;color:#1F4E79;background:#FFFFFF;border:1px solid #CFE6FF;border-radius:9px;padding:6px 9px;width:100%;box-sizing:border-box}
.nls-check{display:flex;align-items:center;gap:6px;font-size:13px;color:#33556F}
.nls-note{font-size:12px;color:#6B8CB0;margin-top:6px;line-height:18px}
.nls-status{font-size:12px;color:#6B8CB0;margin-top:8px}
`;

    /* ---------------- 极简状态仓库（host 权威，浏览器只读+发动作） ---------------- */
    let snapshot = null;
    let cases = [];
    let caseStatus = null;
    let lastError = null;
    const listeners = new Set();

    function publish(patch) {
      if (patch.snapshot !== undefined) snapshot = patch.snapshot;
      if (patch.cases !== undefined) cases = patch.cases;
      if (patch.caseStatus !== undefined) caseStatus = patch.caseStatus;
      if (patch.error !== undefined) lastError = patch.error;
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {
          /* 单个订阅者出错不影响其它 */
        }
      }
    }

    function useStore() {
      const [, force] = useState(0);
      useEffect(() => {
        const fn = () => force((n) => n + 1);
        listeners.add(fn);
        return () => listeners.delete(fn);
      }, []);
      return { snapshot, cases, caseStatus, lastError };
    }

    async function fetchState() {
      try {
        const res = await fetch(`${API}/state`, { headers: { accept: "application/json" } });
        if (res.ok) publish({ snapshot: await res.json(), error: null });
      } catch (error) {
        publish({ error: String(error && error.message ? error.message : error) });
      }
    }

    async function fetchCases() {
      try {
        const res = await fetch(`${API}/cases`, { headers: { accept: "application/json" } });
        if (res.ok) {
          const data = await res.json();
          publish({ cases: data.cases ?? [], caseStatus: data.status ?? null });
        }
      } catch {
        /* 案例拿不到就退化成只有伤害说明 */
      }
    }

    async function sendAction(action) {
      try {
        const res = await fetch(`${API}/choice`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => null);
        if (data && data.state) publish({ snapshot: data.state, error: null });
        else await fetchState();
        return Boolean(data && data.ok);
      } catch (error) {
        publish({ error: String(error && error.message ? error.message : error) });
        return false;
      }
    }

    async function refreshCasesNow() {
      try {
        const res = await fetch(`${API}/refresh-cases`, { method: "POST", headers: { accept: "application/json" } });
        const data = await res.json().catch(() => null);
        if (data?.status) publish({ caseStatus: data.status });
        await fetchCases();
        return Boolean(data && data.ok);
      } catch {
        return false;
      }
    }

    /* ---------------- 小工具 ---------------- */
    function fmtClock(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    function fmtDuration(ms) {
      const total = Math.max(0, Math.round(ms / 60000));
      if (total < 60) return `${total} 分钟`;
      const hr = Math.floor(total / 60);
      const rest = total % 60;
      return rest === 0 ? `${hr} 小时` : `${hr} 小时 ${rest} 分钟`;
    }

    function phaseArt(phase) {
      if (phase === "break") return "rise";
      if (phase === "awaitReturn") return "drink";
      if (phase === "stopped") return "sleep";
      return "idle";
    }

    const ART_FALLBACK = {
      idle: "anim/idle.webp",
      rise: "anim/rise.webp",
      drink: "anim/drink.webp",
      sleep: "anim/sleep.webp",
    };

    function artRel(rel) {
      return `${API}/art?f=${encodeURIComponent(rel)}`;
    }

    /* ---- 提示音：Web Audio 现场合成"滴滴滴"，不依赖素材文件、无版权问题 ----
     * 浏览器自动播放策略要求先有用户手势，所以在 apply 里挂一次性解锁监听；
     * 之后阶段切换（专注到点 / 休息结束）直接播放。
     */
    let audioCtx = null;

    function audioContext() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        if (!audioCtx) audioCtx = new Ctor();
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
        return audioCtx;
      } catch {
        return null;
      }
    }

    /** 用户第一次点页面/敲键盘时把音频上下文唤醒（静音播放一个 20ms 的空音） */
    function unlockAudio() {
      const ctx = audioContext();
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.02);
      } catch {
        /* 忽略：静音解锁失败不影响主流程 */
      }
    }

    /** 播放 n 声"滴"（880Hz 正弦，指数衰减包络） */
    function playBeeps(times, volume, spacing) {
      const ctx = audioContext();
      if (!ctx) return;
      const vol = Math.min(1, Math.max(0.02, Number(volume) || 0.6));
      const gap = Number(spacing) > 0 ? Number(spacing) : 0.24;
      const start = ctx.currentTime + 0.02;
      for (let i = 0; i < times; i++) {
        const at = start + i * gap;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.19);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.22);
      }
    }

    /* ---- 素材清单：支持「帧序列 / 单文件动图 / 静态图」三种形态 ----
     * 全由 assets/pet-manifest.json 描述，换素材只改清单 + 放文件，不动代码：
     *   {"type":"frames","dir":"frames/idle","ext":"png","count":8,"fps":8}  → 依次播放 idle-01..idle-08
     *   {"type":"file","src":"anim/idle.webp"}                               → 单文件（WebP/GIF/SVG 自动播放）
     *   （清单缺失或状态未定义时回落到内置 SVG）
     */
    let artManifest = null;
    let artManifestLoading = null;
    const frameCache = new Map();

    function loadArtManifest() {
      if (artManifest) return Promise.resolve(artManifest);
      if (!artManifestLoading) {
        artManifestLoading = fetch(artRel("pet-manifest.json"), { headers: { accept: "application/json" } })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
          .then((data) => {
            artManifest = data && typeof data === "object" ? data : { states: {} };
            publish({});
            return artManifest;
          });
      }
      return artManifestLoading;
    }

    function preloadFrames(state, spec) {
      const key = `${state}|${spec.dir}|${spec.count}|${spec.ext || "png"}`;
      const cached = frameCache.get(key);
      if (cached) return cached;
      const list = [];
      for (let i = 1; i <= Number(spec.count); i++) {
        const img = new Image();
        img.src = artRel(`${spec.dir}/${state}-${String(i).padStart(2, "0")}.${spec.ext || "png"}`);
        list.push(img);
      }
      frameCache.set(key, list);
      return list;
    }

    function useArtManifest() {
      const [, force] = useState(0);
      useEffect(() => {
        let alive = true;
        loadArtManifest().then(() => {
          if (alive) force((n) => n + 1);
        });
        return () => {
          alive = false;
        };
      }, []);
      return artManifest;
    }

    /** 宠物图组件：帧序列优先，其次单文件，最后内置 SVG 兜底。 */
    function PetImage(props) {
      const state = props.state || "idle";
      const manifest = useArtManifest();
      const spec = manifest && manifest.states ? manifest.states[state] : null;
      const count = spec && spec.type === "frames" ? Math.max(1, Math.floor(Number(spec.count) || 1)) : 1;
      const fps = spec && Number(spec.fps) > 0 ? Math.min(30, Number(spec.fps)) : 8;
      const [index, setIndex] = useState(0);

      useEffect(() => {
        if (count <= 1 || !spec) return undefined;
        preloadFrames(state, spec);
        const timer = setInterval(() => setIndex((i) => (i + 1) % count), Math.max(33, Math.round(1000 / fps)));
        return () => clearInterval(timer);
      }, [state, count, fps, spec && spec.dir, spec && spec.ext]);

      let src;
      if (spec && spec.type === "frames" && typeof spec.dir === "string") {
        const n = String((index % count) + 1).padStart(2, "0");
        src = artRel(`${spec.dir}/${state}-${n}.${spec.ext || "png"}`);
      } else if (spec && spec.type === "file" && typeof spec.src === "string") {
        src = artRel(spec.src);
      } else {
        src = artRel(ART_FALLBACK[state] || ART_FALLBACK.idle);
      }
      return h("img", { src, alt: props.alt || "", className: props.className });
    }

    /** 本地 1s 时钟：host 给绝对时间戳，倒计时由浏览器自己算（不额外打接口）。 */
    function useNow(active) {
      const [now, setNow] = useState(() => Date.now());
      useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, [active]);
      return now;
    }

    /* ---------------- 组件：悬浮猫猫（可拖动 + 位置记忆 + 不透明度可调） ---------------- */
    const PET_POS_KEY = "dsh-no-long-sit:pet-pos";
    const PET_WIDTH = 104;

    function loadPetPos() {
      try {
        const raw = localStorage.getItem(PET_POS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Number.isFinite(parsed && parsed.left) && Number.isFinite(parsed && parsed.top)) {
            return { left: parsed.left, top: parsed.top };
          }
        }
      } catch {
        /* localStorage 不可用就用默认位置 */
      }
      return null;
    }

    function savePetPos(pos) {
      try {
        localStorage.setItem(PET_POS_KEY, JSON.stringify(pos));
      } catch {
        /* 忽略：存不下也不影响本次拖动 */
      }
    }

    function defaultPetPos() {
      return {
        left: Math.max(8, window.innerWidth - PET_WIDTH - 22),
        top: Math.max(8, window.innerHeight - 150),
      };
    }

    /** 把猫猫夹在视口内（含拖动后窗口变小的情况） */
    function clampPetPos(pos, element) {
      const width = (element && element.offsetWidth) || PET_WIDTH;
      const height = (element && element.offsetHeight) || 126;
      return {
        left: Math.min(Math.max(0, Math.round(pos.left)), Math.max(0, window.innerWidth - width)),
        top: Math.min(Math.max(0, Math.round(pos.top)), Math.max(0, window.innerHeight - height)),
      };
    }

    function FloatingPet(props) {
      const { snap, now, onAction, onOpenCases } = props;
      const [open, setOpen] = useState(false);
      const [dragging, setDragging] = useState(false);
      const [pos, setPos] = useState(() => loadPetPos() || defaultPetPos());
      const petRef = useRef(null);
      const dragRef = useRef(null);
      const opacity = Number.isFinite(Number(snap.petOpacity)) ? Number(snap.petOpacity) : 0.75;
      const remaining = snap.phase === "focus" ? Math.max(0, snap.phaseEndsAt - now) : 0;
      const label = snap.phase === "focus"
        ? `${PHASE_TEXT.focus} ${fmtClock(remaining)}`
        : PHASE_TEXT[snap.phase] ?? "";

      // 首帧按真实尺寸收敛一次位置
      useEffect(() => {
        setPos((current) => clampPetPos(current, petRef.current));
      }, []);

      // 视口变化时把猫猫拉回可见区域并记住
      useEffect(() => {
        const onResize = () => setPos((current) => {
          const next = clampPetPos(current, petRef.current);
          savePetPos(next);
          return next;
        });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);

      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        const rect = petRef.current && petRef.current.getBoundingClientRect();
        if (!rect) return;
        dragRef.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
        };
        try {
          event.currentTarget.setPointerCapture && event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 合成事件没有真实 pointerId，忽略 */
        }
        setDragging(true);
      };

      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 4) return;
        drag.moved = true;
        setPos(clampPetPos({ left: event.clientX - drag.offsetX, top: event.clientY - drag.offsetY }, petRef.current));
      };

      const endDrag = (event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        try {
          event.currentTarget.releasePointerCapture && event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          /* 忽略 */
        }
        if (!drag) return;
        setPos((current) => {
          savePetPos(current);
          return current;
        });
        // 没移动 = 点击 → 切换菜单；拖动过 = 只挪位置，不弹菜单
        if (!drag.moved) setOpen((value) => !value);
      };

      const popLeft = Math.min(
        Math.max(8, pos.left + PET_WIDTH - 208),
        Math.max(8, window.innerWidth - 208 - 8),
      );
      const popStyle = pos.top > 220
        ? { left: `${popLeft}px`, top: `${pos.top - 10}px`, transform: "translateY(-100%)" }
        : { left: `${popLeft}px`, top: `${pos.top + 132}px` };

      return h(
        "div",
        null,
        open
          ? h(
              "div",
              { className: "nls-card nls-pet-pop", style: popStyle },
              h("div", { style: { fontWeight: 700, marginBottom: 6 } }, `${snap.address}，猫猫在看着你哦`),
              h(
                "div",
                { style: { color: "#3C6E9B", marginBottom: 8 } },
                snap.phase === "focus"
                  ? `本轮专注还剩 ${fmtClock(remaining)}（已完成 ${snap.focusRounds} 轮）`
                  : `${PHASE_TEXT[snap.phase] ?? ""}，建议休息 ${snap.breakMinutes} 分钟`,
              ),
              h(
                "div",
                { style: { color: "#7B9CBC", fontSize: 12, marginBottom: 8 } },
                "按住我可以拖到任意位置（位置会记住）",
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
                h(
                  "button",
                  { className: "nls-btn", onClick: () => { setOpen(false); onOpenCases(); } },
                  "看看案例",
                ),
                snap.phase === "stopped"
                  ? h(
                      "button",
                      { className: "nls-btn nls-btn-primary", onClick: () => { setOpen(false); onAction("start"); } },
                      "开始新一轮",
                    )
                  : h(
                      "button",
                      { className: "nls-btn", onClick: () => { setOpen(false); onAction("finish"); } },
                      "结束并看总结",
                    ),
              ),
            )
          : null,
        h(
          "div",
          {
            ref: petRef,
            className: dragging ? "nls-pet nls-pet-dragging" : "nls-pet",
            title: "猫猫 · 久坐提醒（拖动换位置，点一下看菜单）",
            style: { left: `${pos.left}px`, top: `${pos.top}px`, opacity },
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
          },
          h(PetImage, { state: phaseArt(snap.phase), alt: "猫猫" }),
          h("span", { className: "nls-pet-badge" }, label),
        ),
      );
    }

    /* ---------------- 组件：提醒窗 ---------------- */
    function ReminderWindow(props) {
      const { snap, now, onAction } = props;
      const [warn, setWarn] = useState(false);
      const isBreak = snap.phase === "break";
      const remaining = Math.max(0, snap.phaseEndsAt - now);
      const art = isBreak ? "rise" : "drink";
      const title = isBreak
        ? `${snap.address}，起来走两步、喝口水吧`
        : `${snap.address}，休息够了，回来干活`;
      const sub = isBreak
        ? `已经连续专注 ${snap.focusMinutes} 分钟了。猫猫建议你离开椅子活动 ${snap.breakMinutes} 分钟。`
        : "猫猫已经把水杯递过来了，点一下就开始下一轮专注。";

      const primary = async () => {
        if (isBreak && snap.earlyBreakGuard && remaining > 30 * 1000) {
          // 休息没到点就想开工 → 软提示一次，再点才生效
          if (!warn) {
            setWarn(true);
            return;
          }
        }
        await onAction(isBreak ? "rest-done" : "work-start");
      };

      return h(
        "div",
        { className: "nls-card nls-win" },
        h(
          "div",
          { className: "nls-head" },
          h(PetImage, { state: art, alt: "" }),
          h(
            "div",
            { style: { flex: 1 } },
            h("p", { className: "nls-title" }, title),
            h("p", { className: "nls-sub" }, sub),
            isBreak
              ? h(
                  "div",
                  { className: "nls-row" },
                  h("span", { style: { fontSize: 12, color: "#6B8CB0" } }, "建议休息倒计时"),
                  h("span", { className: "nls-big" }, fmtClock(remaining)),
                )
              : null,
          ),
        ),
        warn && isBreak
          ? h(
              "div",
              { className: "nls-warn" },
              `才休息了不到 1 分钟，再站一会儿？确认要现在开始下一轮就再点一次。`,
            )
          : null,
        h(
          "div",
          { className: "nls-btns" },
          h(
            "button",
            { className: "nls-btn", onClick: () => onAction("finish") },
            "结束",
          ),
          h(
            "button",
            { className: "nls-btn", onClick: () => onAction("snooze") },
            "再等会",
          ),
          h(
            "button",
            { className: "nls-btn nls-btn-primary", onClick: primary },
            isBreak ? "休息好了" : "开始干活",
          ),
        ),
      );
    }

    /* ---------------- 组件：伤害案例窗 ---------------- */
    function CaseWindow(props) {
      const { snap, cases, caseStatus, onClose } = props;
      // 每次只给一条久坐 + 一条缺水；rotation 让多次提醒轮换案例，不至于天天看同一条
      const pick = (kind) => {
        const arr = (cases ?? []).filter((c) => c.kind === kind);
        if (arr.length === 0) return null;
        const raw = Number(props.rotation) || 0;
        return arr[((raw % arr.length) + arr.length) % arr.length];
      };
      const sit = pick("sit");
      const water = pick("water");
      const renderCase = (c, i) =>
        h(
          "div",
          { className: "nls-case", key: `${c.url}-${i}` },
          h("p", { className: "nls-case-title" }, c.title),
          h("p", { className: "nls-case-fact" }, c.fact),
          h(
            "div",
            { className: "nls-case-meta" },
            `${c.source || "来源"}${c.publishedAt ? ` · ${c.publishedAt}` : ""} · `,
            h("a", { href: c.url, target: "_blank", rel: "noreferrer noopener" }, "查看原始报道"),
          ),
        );

      return h(
        "div",
        { className: "nls-mask nls-mask-cases" },
        h(
          "div",
          { className: "nls-card nls-win-wide", style: { padding: "18px 20px 16px" } },
          h("p", { className: "nls-title" }, `${snap.address}，先别急着继续——久坐和缺水是这么算账的`),
          h(
            "p",
            { className: "nls-sub" },
            "久坐会让下肢血流变慢、血栓风险上升；不喝水会让血液更黏、肾脏负担更重。下面都是真实发生过或被研究证实的案例，点链接可看原文。",
          ),
          h(
            "div",
            { className: "nls-sec" },
            h("p", { className: "nls-sec-title" }, h("span", { className: "nls-tag" }, "久坐"), "坐久了会怎样"),
            sit ? renderCase(sit, 0) : h("p", { className: "nls-note" }, "案例库暂不可用（详见设置页状态）。"),
          ),
          h(
            "div",
            { className: "nls-sec" },
            h("p", { className: "nls-sec-title" }, h("span", { className: "nls-tag" }, "缺水"), "不喝水会怎样"),
            water ? renderCase(water, 1) : h("p", { className: "nls-note" }, "案例库暂不可用（详见设置页状态）。"),
          ),
          h(
            "div",
            { className: "nls-hint" },
            caseStatus?.lastError
              ? `案例库上次刷新失败：${caseStatus.lastError}`
              : `案例库共 ${(cases ?? []).length} 条${caseStatus?.lastSuccessAt ? `，最近更新 ${new Date(caseStatus.lastSuccessAt).toLocaleString()}` : ""}`,
          ),
          h(
            "div",
            { className: "nls-btns" },
            h("button", { className: "nls-btn nls-btn-primary", onClick: onClose }, "我这就去休息"),
          ),
        ),
      );
    }

    /* ---------------- 组件：总结窗 ---------------- */
    function SummaryWindow(props) {
      const { summary, onClose } = props;
      const stat = (label, value) => h("div", { className: "nls-stat" }, h("b", null, value), h("span", null, label));
      return h(
        "div",
        { className: "nls-mask nls-mask-summary" },
        h(
          "div",
          { className: "nls-card nls-win-wide", style: { padding: "18px 20px 16px" } },
          h(
            "div",
            { className: "nls-head" },
            h(PetImage, { state: "sleep", alt: "" }),
            h(
              "div",
              null,
              h("p", { className: "nls-title" }, "本次久坐报告"),
              h(
                "p",
                { className: "nls-sub" },
                `${new Date(summary.startedAt).toLocaleTimeString()} — ${new Date(summary.endedAt).toLocaleTimeString()}`,
              ),
              h(
                "p",
                { style: { marginTop: 6 } },
                h("span", { className: `nls-grade ${GRADE_CLASS[summary.grade]}` }, `评价：${GRADE_TEXT[summary.grade]}`),
              ),
            ),
          ),
          h(
            "div",
            { className: "nls-stats" },
            stat("本次工作", fmtDuration(summary.workMs)),
            stat("完成专注", `${summary.focusRounds} 轮`),
            stat("成功中断久坐", `${summary.breaksTaken} 次`),
            stat("提醒触发", `${summary.breakOpportunities} 次`),
            stat("再等会", `${summary.snoozeTotal} 次`),
            stat("建议喝水", `${summary.suggestedDrinks} 次`),
          ),
          h("p", { className: "nls-note", style: { marginTop: 12 } }, summary.comment),
          h(
            "div",
            { className: "nls-btns" },
            h("button", { className: "nls-btn nls-btn-primary", onClick: onClose }, "好的"),
          ),
        ),
      );
    }

    /* ---------------- 组件：根（浮层入口） ---------------- */
    function Root() {
      const { snapshot: snap, cases: caseList, caseStatus, lastError } = useStore();
      const [caseOpen, setCaseOpen] = useState(false);
      const [summaryOpen, setSummaryOpen] = useState(false);
      const [localSnoozeUntil, setLocalSnoozeUntil] = useState(0);
      const [caseRotation, setCaseRotation] = useState(0);
      const lastPhaseRef = useRef(null);
      const active = Boolean(snap) && snap.phase !== "stopped";
      const now = useNow(active);

      // 阶段切换：收窗 + 播提示音（专注到点 / 休息结束 / 结束）
      useEffect(() => {
        if (!snap) return;
        const phase = snap.phase;
        const prev = lastPhaseRef.current;
        lastPhaseRef.current = phase;
        setLocalSnoozeUntil(0);
        if (phase === "focus") {
          setCaseOpen(false);
          setSummaryOpen(false);
        }
        if (phase === "stopped" && snap.summary) setSummaryOpen(true);
        if (prev === null || prev === phase || !snap.soundEnabled) return;
        if (phase === "break") playBeeps(3, snap.soundVolume, 0.26);
        else if (phase === "awaitReturn") playBeeps(3, snap.soundVolume, 0.16);
        else if (phase === "stopped") playBeeps(2, (Number(snap.soundVolume) || 0.6) * 0.5, 0.2);
      }, [snap && snap.phase, snap && snap.phaseStartedAt]);

      if (!snap || !snap.enabled) return null;

      // 关键修复：提醒窗只由 snoozeUntil 控制。
      // 旧实现用「记住本阶段已忽略」（dismissedAt === phaseStartedAt）做永久屏蔽，
      // 结果点过一次【再等会】后，整个阶段（包括休息结束的「回来干活」）再也不弹 → 流程卡死。
      const snoozeUntil = Math.max(Number(snap.snoozeUntil) || 0, localSnoozeUntil);
      const snoozed = snoozeUntil > now;
      const reminding = (snap.phase === "break" || snap.phase === "awaitReturn") && !snoozed && !caseOpen;

      const act = async (action) => {
        if (action === "snooze") {
          const scale = Number(snap.timeScale) > 0 ? Number(snap.timeScale) : 1;
          setLocalSnoozeUntil(Date.now() + snap.snoozeMinutes * 60000 * scale);
          const ok = await sendAction("snooze");
          if (ok) {
            await fetchCases();
            setCaseRotation((n) => n + 1);
            setCaseOpen(true);
          }
          return;
        }
        if (action === "finish") {
          await sendAction("finish");
          return;
        }
        await sendAction(action);
      };

      const openCases = async () => {
        await fetchCases();
        setCaseRotation((n) => n + 1);
        setCaseOpen(true);
      };

      /** 关闭案例窗：顺手清掉"再等会"，让休息倒计时窗口立刻回到屏幕上 */
      const closeCases = async () => {
        setCaseOpen(false);
        setLocalSnoozeUntil(0);
        if (snap.phase === "break" || snap.phase === "awaitReturn") await sendAction("resume");
      };

      // 弹窗打开时收起悬浮宠物：浮层右下角与宠物同位，叠在一起会互相压住
      const anyWindowOpen = reminding || caseOpen || (summaryOpen && Boolean(snap.summary));

      return h(
        React.Fragment,
        null,
        snap.showFloatingPet && !anyWindowOpen
          ? h(FloatingPet, { snap, now, onAction: act, onOpenCases: openCases })
          : null,
        reminding
          ? h("div", { className: "nls-mask nls-mask-reminder" }, h(ReminderWindow, { snap, now, onAction: act }))
          : null,
        caseOpen ? h(CaseWindow, { snap, cases: caseList, caseStatus, rotation: caseRotation, onClose: closeCases }) : null,
        summaryOpen && snap.summary ? h(SummaryWindow, { summary: snap.summary, onClose: () => setSummaryOpen(false) }) : null,
        lastError && reminding
          ? h("div", { className: "nls-card", style: { position: "fixed", right: 26, bottom: 150, padding: "8px 12px", fontSize: 12, color: "#A33A3A" } }, `与宿主通信失败：${lastError}`)
          : null,
      );
    }

    /* ---------------- 组件：设置卡片 ---------------- */
    function ConfigSection(props) {
      const form = props.form;
      const [draft, setDraft] = useState(null);
      const [saved, setSaved] = useState("");
      const [snap, setSnap] = useState(() => (form ? form.getSnapshot() : null));

      useEffect(() => {
        if (!form) return undefined;
        setSnap(form.getSnapshot());
        const off = form.subscribe((next) => setSnap(next));
        return () => {
          if (typeof off === "function") off();
        };
      }, [form]);

      const value = (draft ?? snap?.value ?? {}) || {};
      const set = (key, next) => setDraft({ ...value, [key]: next });

      if (!form) {
        return h("div", { className: "nls-note" }, "设置服务未就绪（configForms 缺席），可稍后重开设置页。");
      }

      const save = async () => {
        if (!draft) return;
        const keys = Object.keys(draft);
        let ok = true;
        for (const key of keys) {
          try {
            const result = await form.set(key, draft[key]);
            if (result === false) ok = false;
          } catch {
            ok = false;
          }
        }
        setSaved(ok ? "已保存并立即生效" : "部分字段保存失败，请检查取值范围");
        setDraft(null);
        setTimeout(() => setSaved(""), 3000);
      };

      const num = (key, label, min, max, step) =>
        h(
          "label",
          { className: "nls-field" },
          label,
          h("input", {
            type: "number",
            min,
            max,
            step: step ?? 1,
            value: value[key] ?? "",
            onChange: (event) => set(key, Number(event.target.value)),
          }),
        );

      const check = (key, label) =>
        h(
          "label",
          { className: "nls-check" },
          h("input", {
            type: "checkbox",
            checked: Boolean(value[key]),
            onChange: (event) => set(key, event.target.checked),
          }),
          label,
        );

      return h(
        "div",
        null,
        h(
          "div",
          { className: "nls-form" },
          h(
            "label",
            { className: "nls-field" },
            "猫猫怎么称呼你",
            h("input", {
              type: "text",
              value: value.address ?? "",
              maxLength: 24,
              onChange: (event) => set("address", event.target.value),
            }),
          ),
          num("focusMinutes", "专注周期（分钟，30–90）", 30, 90),
          num("breakMinutes", "休息周期（分钟，3–15）", 3, 15),
          num("snoozeMinutes", "【再等会】间隔（分钟）", 1, 15),
          num("maxSnooze", "每轮最多再等会次数", 0, 5),
          num("soundVolume", "提示音音量（0–1）", 0, 1, 0.05),
          num("petOpacity", "桌宠不透明度（0.2–1，1=完全不透明）", 0.2, 1, 0.05),
          num("awaitReturnTimeoutMinutes", "「回来干活」等待上限（分钟，0=不自动）", 0, 60),
          num("goodRatio", "评价「好」所需中断率", 0.5, 1, 0.05),
          num("midRatio", "评价「中」所需中断率", 0, 0.9, 0.05),
          num("caseRefreshDelayMinutes", "启动后多久刷新案例（分钟）", 1, 120),
          num("timeScale", "时间缩放（仅调试：0.01 = 30 分钟变 18 秒）", 0.001, 1, 0.001),
        ),
        h(
          "div",
          { style: { display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 } },
          check("enabled", "启用提醒"),
          check("soundEnabled", "到点播放提示音（滴滴滴）"),
          check("earlyBreakGuard", "休息没到点就开工时，先软提示一次"),
          check("showFloatingPet", "右下角常驻猫猫（可拖动，位置会记住）"),
          check("caseRefreshEnabled", "启动后自动刷新案例库"),
        ),
        h(
          "div",
          { className: "nls-btns", style: { justifyContent: "flex-start", marginTop: 12 } },
          h("button", { className: "nls-btn nls-btn-primary", onClick: save, disabled: !draft }, "保存"),
          h(
            "button",
            {
              className: "nls-btn",
              onClick: () => {
                unlockAudio();
                playBeeps(3, value.soundVolume, 0.26);
              },
            },
            "试听提示音",
          ),
          h(
            "button",
            {
              className: "nls-btn",
              onClick: async () => {
                setSaved("正在刷新案例库（要联网，最多 1 分钟）…");
                const ok = await refreshCasesNow();
                setSaved(ok ? "案例库已更新" : "刷新失败：已保留旧案例库，详见下方状态");
              },
            },
            "立即刷新案例库",
          ),
        ),
        saved ? h("div", { className: "nls-hint" }, saved) : null,
        h(
          "div",
          { className: "nls-status" },
          `案例库：内置 ${caseStatus?.builtinCount ?? "?"} 条 / 刷新 ${caseStatus?.refreshedCount ?? 0} 条`,
          caseStatus?.lastSuccessAt ? `，最近成功 ${new Date(caseStatus.lastSuccessAt).toLocaleString()}` : "",
          caseStatus?.lastError ? `；上次失败原因：${caseStatus.lastError}` : "",
        ),
        h(
          "div",
          { className: "nls-note" },
          "说明：计时完全在宿主侧进行，刷新页面不会丢；DSH 全部页面关闭时不会再弹窗（没有页面可弹）。案例刷新走宿主检索 + 宿主大模型，失败会保留旧库。",
        ),
      );
    }

    /* ---------------- 插件入口 ---------------- */
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.setAttribute("data-plugin", NS);
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          if (tag.parentNode) tag.parentNode.removeChild(tag);
        };
      }, `${NS}: styles`);

      // 浏览器要求先有用户手势才允许出声：第一次点击/按键时唤醒音频上下文
      ctx.effect(() => {
        const unlock = () => unlockAudio();
        window.addEventListener("pointerdown", unlock, { once: true });
        window.addEventListener("keydown", unlock, { once: true });
        return () => {
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        };
      }, `${NS}: audio unlock`);

      ctx.effect(() => {
        fetchState();
        fetchCases();
        const timer = setInterval(fetchState, POLL_MS);
        // 后台标签页会被浏览器节流：切回前台立刻补一次，避免弹窗/提示音迟到
        const onVisible = () => {
          if (!document.hidden) fetchState();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisible);
        };
      }, `${NS}: state poll`);

      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register({ name: "shell.overlay", id: NS, order: 120 }, Root),
      );

      let form = null;
      const takeForm = (configForms) => {
        try {
          form = configForms?.get?.(NS) ?? null;
        } catch {
          form = null;
        }
      };
      takeForm(ctx.get?.("configForms"));
      if (!form && typeof ctx.inject === "function") {
        ctx.inject(["configForms"], (child) => takeForm(child.configForms));
      }
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: NS,
            order: 320,
            label: () => "猫猫 · 久坐提醒",
            inject: () => ({ form }),
          },
          ConfigSection,
        ),
      );
    }

    module.exports = { name: "dsh-no-long-sit", inject: ["slots"], apply };
    return module.exports;
  },
});
