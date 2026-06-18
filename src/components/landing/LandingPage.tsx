"use client";

/*
 * Phase 33 — Marketing Landing Redesign.
 * Faithful React port of docs/design/landing-prototype.html (Felix-approved spec).
 * Real component (not a raw-HTML drop-in / not an iframe): JSX sections styled by
 * landing.module.css, with the prototype's vanilla-JS motion re-expressed in one
 * useEffect that drives refs + queries `data-*` hooks inside the scoped root.
 *
 * Motion is fully gated on prefers-reduced-motion: heavy effects (gauge tween,
 * typewriter, curve draw, count-up, cursor glow, magnetic, tilt, constellation)
 * are skipped and final states rendered, per the perf/a11y contract.
 *
 * CTAs route into the real app: "Sign in" -> /login, every "Start free" -> /signup.
 * The final email field prefills /signup (it does NOT capture the address here, so
 * the copy stays honest).
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./landing.module.css";

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

// Hero coaching-insight lines that type out in sequence (illustrative copy).
const INSIGHT_LINES = [
  "You opened with a calibrated question at 0:42 — exactly right. Next time, name the implication before you pitch.",
  "Great label on their budget worry. You filled the silence too fast — let it breathe two more seconds.",
  "You earned the close. Lock the next step on the call, not in a follow-up email.",
];

export function LandingPage() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const gnumRef = useRef<HTMLSpanElement>(null);
  const typedRef = useRef<HTMLSpanElement>(null);
  const curveLineRef = useRef<SVGPathElement>(null);
  const curveFillRef = useRef<SVGPathElement>(null);
  const cursorGlowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    /* nav scrolled state */
    const onScroll = () => {
      headerRef.current?.classList.toggle("scrolled", window.scrollY > 10);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener("scroll", onScroll));
    onScroll();

    /* reveal on scroll */
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            if (e.target.hasAttribute("data-stagger")) {
              const kids = e.target.children;
              for (let i = 0; i < kids.length; i++) {
                (kids[i] as HTMLElement).style.transitionDelay = i * 90 + "ms";
              }
            }
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    /* hero gauge + bars (fire on load) */
    const target = 78;
    const gnum = gnumRef.current;
    const gauge = gaugeRef.current;
    const fills = () =>
      root.querySelectorAll<HTMLElement>("[data-fill]").forEach((f) => {
        f.style.width = (f.dataset.w || "0") + "%";
      });
    if (gnum && gauge) {
      if (reduce) {
        gnum.textContent = String(target);
        gauge.style.background =
          "conic-gradient(from -90deg,var(--v3) " +
          target +
          "%,rgba(255,255,255,.06) " +
          target +
          "%)";
        fills();
      } else {
        let s: number | null = null;
        const step = (t: number) => {
          if (s === null) s = t;
          const p = Math.min((t - s) / 1500, 1);
          const e = 1 - Math.pow(1 - p, 3);
          gnum.textContent = String(Math.round(e * target));
          gauge.style.background =
            "conic-gradient(from -90deg,var(--v3) " +
            e * target +
            "%, #2fe6ff " +
            e * target +
            "%, rgba(255,255,255,.06) " +
            e * target +
            "%)";
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        const to = setTimeout(fills, 300);
        cleanups.push(() => clearTimeout(to));
      }
    }

    /* typewriter insight */
    const typed = typedRef.current;
    if (typed) {
      if (reduce) {
        typed.textContent = INSIGHT_LINES[0];
        typed.classList.remove(styles.typed);
      } else {
        let li = 0;
        let timer: ReturnType<typeof setTimeout>;
        const type = () => {
          const txt = INSIGHT_LINES[li];
          let i = 0;
          typed.textContent = "";
          const ch = () => {
            if (i <= txt.length) {
              typed.textContent = txt.slice(0, i);
              i++;
              timer = setTimeout(ch, 18);
            } else {
              timer = setTimeout(erase, 2600);
            }
          };
          ch();
        };
        const erase = () => {
          const txt = typed.textContent || "";
          let i = txt.length;
          const ch = () => {
            if (i >= 0) {
              typed.textContent = txt.slice(0, i);
              i -= 2;
              timer = setTimeout(ch, 10);
            } else {
              li = (li + 1) % INSIGHT_LINES.length;
              timer = setTimeout(type, 250);
            }
          };
          ch();
        };
        type();
        cleanups.push(() => clearTimeout(timer));
      }
    }

    /* curve draw on view */
    const curveLine = curveLineRef.current;
    const curveFill = curveFillRef.current;
    if (curveLine && curveFill) {
      const len = curveLine.getTotalLength();
      curveLine.style.strokeDasharray = String(len);
      curveLine.style.strokeDashoffset = reduce ? "0" : String(len);
      const cio = new IntersectionObserver(
        (es) => {
          es.forEach((e) => {
            if (e.isIntersecting) {
              if (!reduce) {
                curveLine.style.transition =
                  "stroke-dashoffset 1.8s cubic-bezier(.3,.7,.2,1)";
                curveLine.style.strokeDashoffset = "0";
                curveFill.style.transition = "opacity 1.4s .6s";
              }
              curveFill.style.opacity = "1";
              cio.unobserve(e.target);
            }
          });
        },
        { threshold: 0.4 },
      );
      cio.observe(curveLine);
      cleanups.push(() => cio.disconnect());
    }

    /* count-up metrics */
    const mwrap = root.querySelector(".js-metrics");
    if (mwrap) {
      const mio = new IntersectionObserver(
        (es) => {
          es.forEach((e) => {
            if (e.isIntersecting) {
              root.querySelectorAll<HTMLElement>("[data-count]").forEach((c) => {
                const to = parseFloat(c.dataset.to || "0");
                const dec = parseInt(c.dataset.dec || "0", 10);
                const pre = c.dataset.pre || "";
                const suf = c.dataset.suf || "";
                const full = c.textContent || "";
                if (reduce) return;
                let s: number | null = null;
                const step = (t: number) => {
                  if (s === null) s = t;
                  const p = Math.min((t - s) / 1200, 1);
                  const ev = 1 - Math.pow(1 - p, 3);
                  c.textContent = pre + (to * ev).toFixed(dec) + suf;
                  if (p < 1) requestAnimationFrame(step);
                  else c.textContent = full;
                };
                requestAnimationFrame(step);
              });
              mio.disconnect();
            }
          });
        },
        { threshold: 0.5 },
      );
      mio.observe(mwrap);
      cleanups.push(() => mio.disconnect());
    }

    /* cursor glow + magnetic + tilt (desktop, fine pointer only) */
    if (window.matchMedia("(pointer:fine)").matches && !reduce) {
      const glow = cursorGlowRef.current;
      const onMove = (e: MouseEvent) => {
        if (!glow) return;
        glow.style.opacity = "1";
        glow.style.left = e.clientX + "px";
        glow.style.top = e.clientY + "px";
      };
      window.addEventListener("mousemove", onMove, { passive: true });
      cleanups.push(() => window.removeEventListener("mousemove", onMove));

      root.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((b) => {
        const move = (e: MouseEvent) => {
          const r = b.getBoundingClientRect();
          b.style.transform =
            "translate(" +
            (e.clientX - r.left - r.width / 2) * 0.25 +
            "px," +
            (e.clientY - r.top - r.height / 2) * 0.35 +
            "px)";
        };
        const leave = () => {
          b.style.transform = "";
        };
        b.addEventListener("mousemove", move);
        b.addEventListener("mouseleave", leave);
        cleanups.push(() => {
          b.removeEventListener("mousemove", move);
          b.removeEventListener("mouseleave", leave);
        });
      });

      const tp = root.querySelector<HTMLElement>("[data-tilt]");
      if (tp && tp.parentElement) {
        const stage = tp.parentElement;
        const move = (e: MouseEvent) => {
          const r = stage.getBoundingClientRect();
          const rx = ((e.clientY - r.top) / r.height - 0.5) * -6;
          const ry = ((e.clientX - r.left) / r.width - 0.5) * 8;
          tp.style.transform = "rotateX(" + rx + "deg) rotateY(" + ry + "deg)";
        };
        const leave = () => {
          tp.style.transform = "";
        };
        stage.addEventListener("mousemove", move);
        stage.addEventListener("mouseleave", leave);
        cleanups.push(() => {
          stage.removeEventListener("mousemove", move);
          stage.removeEventListener("mouseleave", leave);
        });
      }
    }

    /* constellation canvas */
    if (!reduce && canvasRef.current) {
      const cv = canvasRef.current;
      const ctx = cv.getContext("2d");
      if (ctx) {
        const DPR = Math.min(window.devicePixelRatio || 1, 2);
        let W = 0;
        let H = 0;
        let pts: Array<{ x: number; y: number; vx: number; vy: number }> = [];
        let mx = -999;
        let my = -999;
        let raf = 0;
        const size = () => {
          W = cv.width = window.innerWidth * DPR;
          H = cv.height = window.innerHeight * DPR;
          cv.style.width = window.innerWidth + "px";
          cv.style.height = window.innerHeight + "px";
          const n = Math.min(80, Math.floor(window.innerWidth / 18));
          pts = [];
          for (let i = 0; i < n; i++)
            pts.push({
              x: Math.random() * W,
              y: Math.random() * H,
              vx: (Math.random() - 0.5) * 0.18 * DPR,
              vy: (Math.random() - 0.5) * 0.18 * DPR,
            });
        };
        size();
        window.addEventListener("resize", size);
        const onMove = (e: MouseEvent) => {
          mx = e.clientX * DPR;
          my = e.clientY * DPR;
        };
        window.addEventListener("mousemove", onMove, { passive: true });
        const maxD = 130 * DPR;
        const loop = () => {
          ctx.clearRect(0, 0, W, H);
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.3 * DPR, 0, 7);
            ctx.fillStyle = "rgba(150,170,255,.5)";
            ctx.fill();
            for (let j = i + 1; j < pts.length; j++) {
              const q = pts[j];
              const dx = p.x - q.x;
              const dy = p.y - q.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < maxD) {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.strokeStyle = "rgba(124,150,255," + 0.13 * (1 - d / maxD) + ")";
                ctx.lineWidth = 1;
                ctx.stroke();
              }
            }
            const ddx = p.x - mx;
            const ddy = p.y - my;
            const dd = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dd < 180 * DPR) {
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(mx, my);
              ctx.strokeStyle = "rgba(47,230,255," + 0.18 * (1 - dd / (180 * DPR)) + ")";
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
        cleanups.push(() => {
          cancelAnimationFrame(raf);
          window.removeEventListener("resize", size);
          window.removeEventListener("mousemove", onMove);
        });
      }
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  const goSignup = (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailRef.current?.value.trim();
    router.push(email ? `/signup?email=${encodeURIComponent(email)}` : "/signup");
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.bgWrap}>
        <div className={cx(styles.blob, styles.blobA)} />
        <div className={cx(styles.blob, styles.blobB)} />
        <div className={cx(styles.blob, styles.blobC)} />
      </div>
      <div className={styles.grain} />
      <canvas ref={canvasRef} className={styles.constellation} aria-hidden="true" />
      <div ref={cursorGlowRef} className={styles.cursorGlow} aria-hidden="true" />

      {/* NAV */}
      <header ref={headerRef}>
        <nav className={styles.nav}>
          <div className={styles.logo}>
            <span className={styles.mark} aria-hidden="true" />
            Critiq
          </div>
          <div className={styles.navLinks}>
            <a href="#how">How it works</a>
            <a href="#pillars">The pillars</a>
            <a href="#learns">It learns you</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className={styles.navCta}>
            <Link href="/login" className={cx(styles.btn, styles.btnGhost)}>
              Sign in
            </Link>
            <Link href="/signup" className={cx(styles.btn, styles.btnPrimary)} data-magnetic>
              Start free
            </Link>
          </div>
        </nav>
      </header>

      <main>
      {/* HERO */}
      <section className={cx(styles.hero, styles.wrap)}>
        <div>
          <span className={styles.eyebrow}>
            <span className={styles.dot} />
            AI Sales Coach
          </span>
          <h1>
            Every call, <span className={styles.gradText}>coached.</span>
            <br />
            Every week, <span className={styles.gradText}>sharper.</span>
          </h1>
          <p className={styles.sub}>
            Critiq is the AI sales coach that learns how <em>you</em> sell. It preps you
            before every call, breaks down what happened after, and compounds into an edge
            your competition can&apos;t copy.
          </p>
          <div className={styles.heroCta}>
            <Link
              href="/signup"
              className={cx(styles.btn, styles.btnPrimary, styles.btnLg)}
              data-magnetic
            >
              Start free <span className={styles.arrow}>→</span>
            </Link>
            <a href="#how" className={cx(styles.btn, styles.btnLine, styles.btnLg)}>
              See how it works
            </a>
          </div>
          <div className={styles.trust}>
            <div className={styles.label}>Built on the playbooks elite sellers swear by</div>
            <div className={styles.frames}>
              <span className={styles.frame}>
                <i />
                SPIN Selling
              </span>
              <span className={styles.frame}>
                <i />
                The Voss Method
              </span>
              <span className={styles.frame}>
                <i />
                Navarro Methodology
              </span>
            </div>
          </div>
        </div>

        <div className={styles.stage}>
          <div className={styles.panel} data-tilt>
            <div className={styles.panelHead}>
              <span className={styles.live}>
                <span className={styles.d} />
                Live call analysis
              </span>
              <span className={styles.tag}>Riverside Contractors · Discovery</span>
            </div>
            <div className={styles.scoreRow}>
              <div ref={gaugeRef} className={styles.gauge}>
                <div className={styles.num}>
                  <span ref={gnumRef}>0</span>
                  <small>/100</small>
                </div>
              </div>
              <div className={styles.scoreMeta}>
                <div className={styles.t}>Strong call.</div>
                <div className={styles.s}>
                  Above your 30-day average. Discovery was your sharpest yet.
                </div>
              </div>
            </div>
            <div className={styles.bars}>
              <div className={styles.bar}>
                <div className={styles.top}>
                  <b>SPIN · Structure</b>
                  <span>82</span>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <div className={styles.fill} data-fill data-w="82" />
                </div>
              </div>
              <div className={styles.bar}>
                <div className={styles.top}>
                  <b>Voss · Mechanics</b>
                  <span>74</span>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <div className={styles.fill} data-fill data-w="74" />
                </div>
              </div>
              <div className={styles.bar}>
                <div className={styles.top}>
                  <b>Navarro · Relationship</b>
                  <span>80</span>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <div className={styles.fill} data-fill data-w="80" />
                </div>
              </div>
            </div>
            <div className={styles.insight}>
              <span className={styles.ic}>✦</span>
              <span ref={typedRef} className={styles.typed} aria-hidden="true" />
            </div>
          </div>
          <div className={cx(styles.floatBadge, styles.fb1)}>
            <span
              className={styles.ed}
              style={{ background: "var(--lime)", boxShadow: "0 0 10px var(--lime)" }}
            />
            Objective set: book the site walk
          </div>
          <div className={cx(styles.floatBadge, styles.fb2)}>
            <span
              className={styles.ed}
              style={{ background: "var(--v3)", boxShadow: "0 0 10px var(--v3)" }}
            />
            +9 vs. your last call
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className={cx(styles.problem, styles.wrap)}>
        <span className={styles.eyebrow} data-reveal>
          <span className={styles.dot} />
          The gap
        </span>
        <h2 className={styles.reveal} data-reveal>
          You don&apos;t get the call back.
          <br />
          <span className={styles.mutedLine}>So why are you still winging it?</span>
        </h2>
        <p className={styles.reveal} data-reveal>
          Most reps walk in unprepared, forget half of what happened, and never get a
          straight answer on what to fix. Talent stays raw. Critiq closes the loop — every
          call becomes the lesson that wins the next one.
        </p>
      </section>

      {/* HOW IT WORKS */}
      <section className={cx(styles.pad, styles.wrap)} id="how">
        <div className={styles.shead}>
          <span className={styles.eyebrow} data-reveal>
            <span className={styles.dot} />
            The loop
          </span>
          <h2 className={styles.reveal} data-reveal>
            One loop. Relentless improvement.
          </h2>
          <p className={styles.reveal} data-reveal>
            Critiq wraps your real selling motion — not a course you watch once and forget.
            Five steps, every call, compounding.
          </p>
        </div>
        <div className={cx(styles.loop, styles.stagger, styles.reveal)} data-reveal data-stagger>
          <div className={styles.step}>
            <div className={styles.glyph} aria-hidden="true">🎯</div>
            <div className={styles.n}>01 — PREP</div>
            <h3>Walk in ready</h3>
            <p>
              A pre-call brief, a delivery-cued script, and one clear objective — built from
              everything Critiq knows about the account.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.glyph} aria-hidden="true">🎙️</div>
            <div className={styles.n}>02 — CALL</div>
            <h3>Just sell</h3>
            <p>
              Record on your laptop or your phone. Zoom, Teams, or in person. Critiq listens
              so you don&apos;t have to take notes.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.glyph} aria-hidden="true">💬</div>
            <div className={styles.n}>03 — DEBRIEF</div>
            <h3>Talk it out</h3>
            <p>
              Tell Critiq what happened. It listens like a coach in your corner — organizing,
              never judging.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.glyph} aria-hidden="true">📈</div>
            <div className={styles.n}>04 — COACHING</div>
            <h3>Fix the right things</h3>
            <p>
              One to three things to work on next time — each one grounded in what you
              actually said on the call.
            </p>
          </div>
          <div className={styles.step}>
            <div className={styles.glyph} aria-hidden="true">🧠</div>
            <div className={styles.n}>05 — MEMORY</div>
            <h3>Get sharper</h3>
            <p>
              Every call updates what Critiq knows about your accounts and your style.
              Tomorrow&apos;s prep starts smarter.
            </p>
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section className={cx(styles.pad, styles.wrap)} id="pillars">
        <div className={styles.shead}>
          <span className={styles.eyebrow} data-reveal>
            <span className={styles.dot} />
            The scoring engine
          </span>
          <h2 className={styles.reveal} data-reveal>
            Scored the way the pros are trained.
          </h2>
          <p className={styles.reveal} data-reveal>
            Not a vibe check. Critiq grades every conversation against three proven
            frameworks — 100 points, twelve dimensions, evidence-cited line by line.
          </p>
        </div>
        <div className={cx(styles.pillars, styles.stagger, styles.reveal)} data-reveal data-stagger>
          <div className={styles.pillar}>
            <div className={styles.ring} aria-hidden="true" />
            <div className={styles.pts}>35 POINTS</div>
            <h3>SPIN</h3>
            <div className={styles.who}>Call structure</div>
            <p>
              Did you build the case before you pitched? Critiq tracks how you move through
              Situation, Problem, Implication, and Need-payoff.
            </p>
            <ul>
              <li>Surfaced the real problem</li>
              <li>Made the cost of inaction land</li>
              <li>Earned the close</li>
            </ul>
          </div>
          <div className={styles.pillar}>
            <div className={styles.ring} aria-hidden="true" />
            <div className={styles.pts}>35 POINTS</div>
            <h3>Voss</h3>
            <div className={styles.who}>The human mechanics</div>
            <p>
              The tactical-empathy layer that builds trust fast — mirroring, labeling,
              calibrated questions, and the power of strategic silence.
            </p>
            <ul>
              <li>Labeled the objection</li>
              <li>Asked &quot;how&quot; and &quot;what,&quot; not &quot;why&quot;</li>
              <li>Let silence do the work</li>
            </ul>
          </div>
          <div className={styles.pillar}>
            <div className={styles.ring} aria-hidden="true" />
            <div className={styles.pts}>30 POINTS</div>
            <h3>Navarro</h3>
            <div className={styles.who}>The long game</div>
            <p>
              Relationship and territory — the discipline that turns one deal into a book of
              business that competitors can&apos;t pry loose.
            </p>
            <ul>
              <li>Led with genuine curiosity</li>
              <li>Played for the relationship</li>
              <li>Owned the territory</li>
            </ul>
          </div>
        </div>
      </section>

      {/* LEARNS YOU */}
      <section className={cx(styles.pad, styles.wrap)} id="learns">
        <div className={styles.learns}>
          <div data-reveal className={styles.reveal}>
            <span className={styles.eyebrow}>
              <span className={styles.dot} />
              The moat
            </span>
            <h2 style={{ fontSize: "clamp(30px,4vw,46px)", marginTop: "16px" }}>
              It learns how <span className={styles.gradText}>you</span> sell.
            </h2>
            <p style={{ color: "var(--muted)", fontSize: "17px", marginTop: "20px", lineHeight: 1.65 }}>
              Generic AI gives generic advice. Critiq remembers your accounts, your habits,
              and your blind spots — so the coaching is about <em>you</em>, not the average
              rep. The more you use it, the less it sounds like a tool and the more it sounds
              like a coach who&apos;s watched every call you&apos;ve ever made.
            </p>
            <p style={{ color: "var(--muted)", fontSize: "17px", marginTop: "16px", lineHeight: 1.65 }}>
              And it&apos;s honest by design. If Critiq surfaces a detail, it can show you the
              exact moment you said it. No inventing. No making things up.
            </p>
          </div>
          <div className={cx(styles.curveCard, styles.reveal)} data-reveal>
            <div className={styles.cap}>
              <span>Coaching relevance</span>
              <span>per rep</span>
            </div>
            <svg viewBox="0 0 400 200" width="100%" height={180} preserveAspectRatio="none">
              <defs>
                <linearGradient id="critiq-cg" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#8b5cff" />
                  <stop offset="1" stopColor="#2fe6ff" />
                </linearGradient>
                <linearGradient id="critiq-cgf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="rgba(124,92,255,.35)" />
                  <stop offset="1" stopColor="rgba(124,92,255,0)" />
                </linearGradient>
              </defs>
              <path
                ref={curveFillRef}
                d="M0,190 L0,170 C120,160 180,120 250,70 C300,38 350,24 400,16 L400,200 L0,200 Z"
                fill="url(#critiq-cgf)"
                opacity="0"
              />
              <path
                ref={curveLineRef}
                d="M0,170 C120,160 180,120 250,70 C300,38 350,24 400,16"
                fill="none"
                stroke="url(#critiq-cg)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className={styles.milestones}>
              <div className={styles.ms}>
                <b>Call 1</b>
                <span>Learning you</span>
              </div>
              <div className={styles.ms}>
                <b>~10</b>
                <span>Feels personal</span>
              </div>
              <div className={styles.ms}>
                <b>30+</b>
                <span>Full power</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BENTO */}
      <section className={cx(styles.pad, styles.wrap)}>
        <div className={cx(styles.shead, styles.sheadLeft)}>
          <span className={styles.eyebrow} data-reveal>
            <span className={styles.dot} />
            Everything in the kit
          </span>
          <h2 className={styles.reveal} data-reveal>
            A whole coaching staff, in one tab.
          </h2>
        </div>
        <div className={cx(styles.bento, styles.stagger, styles.reveal)} data-reveal data-stagger>
          <div className={cx(styles.cell, styles.cellFeature)}>
            <div className={styles.miniScore} aria-hidden="true">
              <div className={styles.msBar}>
                <i style={{ height: "78%" }} />
              </div>
              <div className={styles.msBar}>
                <i style={{ height: "62%" }} />
              </div>
              <div className={styles.msBar}>
                <i style={{ height: "88%" }} />
              </div>
              <div className={styles.msBar}>
                <i style={{ height: "70%" }} />
              </div>
              <div className={styles.msBar}>
                <i style={{ height: "95%" }} />
              </div>
            </div>
            <h3>Real scores, line by line.</h3>
            <p>
              Every call comes back graded across SPIN, Voss, and Navarro — with the exact
              quotes that earned or cost you the points.
            </p>
          </div>
          <div className={styles.cell}>
            <div className={styles.gl} aria-hidden="true">🎯</div>
            <h3>Pre-call briefs</h3>
            <p>Know the account cold before you dial.</p>
          </div>
          <div className={styles.cell}>
            <div className={styles.gl} aria-hidden="true">📝</div>
            <h3>Delivery-cued scripts</h3>
            <p>Word-for-word, with cues for pace, emphasis, and silence.</p>
          </div>
          <div className={styles.cell}>
            <div className={styles.gl} aria-hidden="true">🔒</div>
            <h3>Private to you</h3>
            <p>Your style, your habits, your data. Yours alone.</p>
          </div>
          <div className={styles.cell}>
            <div className={styles.gl} aria-hidden="true">📱</div>
            <h3>Laptop or phone</h3>
            <p>Built for desk reps and field reps alike.</p>
          </div>
          <div className={cx(styles.cell, styles.cellWide)}>
            <div className={styles.gl} aria-hidden="true">♟️</div>
            <h3>Accounts that get smarter</h3>
            <p>
              A shared, living memory of every account — so the intelligence survives even
              when the rep changes.
            </p>
          </div>
          <div className={styles.cell}>
            <div className={styles.gl} aria-hidden="true">✓</div>
            <h3>Grounded, never invented</h3>
            <p>If Critiq says it, it can show you where you said it.</p>
          </div>
        </div>
      </section>

      {/* ICP */}
      <section className={cx(styles.pad, styles.wrap)}>
        <div className={styles.shead}>
          <span className={styles.eyebrow} data-reveal>
            <span className={styles.dot} />
            Who it&apos;s for
          </span>
          <h2 className={styles.reveal} data-reveal>
            If you live and die by the conversation, it&apos;s for you.
          </h2>
        </div>
        <div className={cx(styles.icp, styles.stagger, styles.reveal)} data-reveal data-stagger>
          <div className={styles.whoCard}>
            <div className={styles.k}>Founders &amp; owners</div>
            <h3>
              You <em>are</em> the sales team.
            </h3>
            <p>
              You&apos;re closing the deals that keep the lights on, with no manager to debrief
              you and no time to take a course. Critiq is the sales mentor you can&apos;t afford
              to hire yet — in your corner before every call that matters.
            </p>
          </div>
          <div className={styles.whoCard}>
            <div className={styles.k}>Reps leveling up</div>
            <h3>You refuse to plateau.</h3>
            <p>
              You&apos;ve hit a number, but you know there&apos;s another gear. Critiq turns every
              call into deliberate practice — the difference between ten years of experience
              and the same year ten times.
            </p>
          </div>
        </div>
      </section>

      {/* PROOF — NOTE: metrics + testimonial are ILLUSTRATIVE PLACEHOLDERS.
          Swap for real beta data before this is promoted to master/production. */}
      <section className={cx(styles.pad, styles.wrap)}>
        <div className={cx(styles.metrics, styles.stagger, styles.reveal, "js-metrics")} data-reveal data-stagger>
          <div className={styles.metric}>
            <div className={styles.v}>
              <span data-count data-to="27" data-pre="+" data-suf="%">
                +27%
              </span>
            </div>
            <div className={styles.l}>more discovery questions asked</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.v}>
              <span data-count data-to="3" data-suf="×" data-dec="1">
                3.5×
              </span>
            </div>
            <div className={styles.l}>faster ramp for new reps</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.v}>
              <span data-count data-to="9" data-suf="/10">
                9/10
              </span>
            </div>
            <div className={styles.l}>reps would tell a friend</div>
          </div>
        </div>
        <div className={cx(styles.quote, styles.reveal)} data-reveal>
          <blockquote>
            &quot;It&apos;s the first thing that ever told me{" "}
            <span className={styles.gradText}>why</span> a call went sideways — not just that
            it did. I prep with it now before anything that matters.&quot;
          </blockquote>
          <div className={styles.by}>
            <b>Alex N.</b> · Commercial Sales Rep · Beta
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={cx(styles.final, styles.wrap)} id="pricing">
        <div className={cx(styles.finalCard, styles.reveal)} data-reveal>
          <span className={styles.eyebrow}>
            <span className={styles.dot} />
            Free during beta · NY &amp; NJ
          </span>
          <h2 style={{ marginTop: "18px" }}>Your next call could be your best one yet.</h2>
          <p>
            Join the beta. Bring one real call. See what a coach who never misses a detail
            actually sounds like.
          </p>
          <form className={styles.capture} onSubmit={goSignup}>
            <input
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-label="Your work email"
            />
            <button
              className={cx(styles.btn, styles.btnPrimary, styles.btnLg)}
              type="submit"
              data-magnetic
            >
              Start free <span className={styles.arrow}>→</span>
            </button>
          </form>
          <div className={styles.fine}>No credit card. Your data stays yours. Cancel anytime.</div>
        </div>
      </section>
      </main>

      {/* FOOTER */}
      <footer>
        <div className={cx(styles.wrap, styles.foot)}>
          <div className={styles.logo} style={{ fontSize: "18px" }}>
            <span className={styles.mark} aria-hidden="true" />
            Critiq
          </div>
          <div className={styles.links}>
            <a href="#how">How it works</a>
            <a href="#pillars">The pillars</a>
            <a href="#pricing">Pricing</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <div className={styles.copy}>© 2026 Critiq · A First Lap company</div>
        </div>
      </footer>
    </div>
  );
}
