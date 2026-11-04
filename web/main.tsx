import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Plus,
  X,
  ShieldCheck,
  Send,
  Wallet,
  Users,
  History,
  Sprout,
  MessageCircle,
  LoaderCircle,
  AlertCircle,
  Sun,
  Moon,
  Trash2,
  Settings,
} from "lucide-react";
import "./style.css";
import { ImportReview } from "./import-review.js";
import { PlanEditor } from "./plan-editor.js";
import { TaskProgress } from "./task-progress.js";
import { AjoJoin, AgreementCheck, feeDescription } from "./ajo-join.js";
import { OrganizerApplicationForm } from "./organizer-application.js";
import { acceptPlanState } from "./plan-state.js";

type Item = Record<string, any>;
type Plan = Item & {
  id: string;
  status: string;
  revision: number;
  spec: Item[];
  tasks: Item[];
};
const money = (kobo: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(kobo / 100);
const initialTheme = () => localStorage.getItem("pw-theme") || "system";
async function api(path: string, body?: unknown) {
  const response = await fetch("/api/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: "same-origin",
      signal: AbortSignal.timeout(15000),
    }),
    value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        value.message || "We could not complete that step. Please try again.",
      ),
      { status: response.status, code: value.error },
    );
  return value;
}
const Icon = ({ type, size = 20 }: { type: string; size?: number }) => {
  const C =
    type === "SETTLED"
      ? CheckCheck
      : type === "PENDING" || type === "QUEUED"
        ? Clock3
        : type === "FAILED"
          ? AlertCircle
          : ArrowUpRight;
  return <C size={size} />;
};
function App() {
  const [session, setSession] = useState<Item | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [workspace, setWorkspace] = useState<Item | null>(null),
    [page, setPage] = useState("home"),
    [plan, setPlanState] = useState<Plan | null>(null),
    [receipt, setReceipt] = useState<Item | null>(null),
    [receiptGroup, setReceiptGroup] = useState<Item[]>([]),
    [receiptIndex, setReceiptIndex] = useState(0),
    [form, setForm] = useState(""),
    [busy, setBusy] = useState(false),
    [theme, setTheme] = useState(initialTheme),
    [reply, setReply] = useState(""),
    [assistantBusy, setAssistantBusy] = useState(false);
  const [whatsappNumber, setWhatsAppNumber] = useState<string | null>(null);
  const [joinContext, setJoinContext] = useState<{
    invite: string;
    proposalId: string | null;
  }>({ invite: "", proposalId: null });
  const [pendingRequest, setPendingRequest] = useState<string | null>(null),
    [assistantProgress, setAssistantProgress] = useState<Item | null>(null);
  const lock = useRef(false),
    shownResult = useRef("");
  function setPlan(value: Plan | null) {
    setPlanState((current) => acceptPlanState(current, value));
  }
  const showError = (e: unknown) =>
    setError(
      e instanceof Error
        ? e.message
        : "Something interrupted that step. Please try again.",
    );
  async function refresh() {
    const w = await api("workspace");
    setWorkspace(w);
    return w;
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (theme === "system") delete document.documentElement.dataset.theme;
    localStorage.setItem("pw-theme", theme);
  }, [theme]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const root = document.documentElement;
      root.style.setProperty(
        "--viewport-height",
        `${viewport?.height || window.innerHeight}px`,
      );
      root.style.setProperty(
        "--viewport-offset",
        `${viewport?.offsetTop || 0}px`,
      );
      root.dataset.keyboard =
        viewport && viewport.height < window.innerHeight * 0.75
          ? "open"
          : "closed";
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    const requestedView = new URLSearchParams(window.location.search).get(
      "view",
    );
    const query = new URLSearchParams(window.location.search),
      invite = query.get("join") || "",
      proposalId = query.get("joinRequest");
    const joining =
      /^[A-Za-z0-9]{8}$/.test(invite) || !!proposalId?.match(/^[a-f0-9-]{36}$/);
    if (joining)
      setJoinContext({
        invite: /^[A-Za-z0-9]{8}$/.test(invite) ? invite : "",
        proposalId,
      });
    if (
      requestedView &&
      ["home", "savings", "ajo", "history", "settings"].includes(requestedView)
    )
      setPage(requestedView);
    const hadFragment = !!window.location.hash.slice(1);
    (async () => {
      void api("config")
        .then((value) => {
          if (mounted) setWhatsAppNumber(value.whatsappNumber);
        })
        .catch(() => {});
      try {
        const fragment = window.location.hash.slice(1);
        if (fragment) {
          history.replaceState(null, "", "/");
          await api("exchange", { token: fragment });
        }
        const s = await api("session");
        if (!mounted) return;
        setSession(s);
        if (s.purpose === "workspace") {
          if (joining) {
            setPage("ajo");
            setForm("ajo_join");
          }
          try {
            const pending = JSON.parse(
              sessionStorage.getItem("pw-request") || "null",
            );
            if (
              pending?.owner === s.user.id &&
              typeof pending.id === "string"
            ) {
              setPendingRequest(pending.id);
              setAssistantBusy(true);
            }
          } catch {
            sessionStorage.removeItem("pw-request");
          }
          const w = await refresh();
          const current = w.plans.find((p: Item) =>
            ["READY", "RUNNING", "PENDING"].includes(p.status),
          );
          if (current) setPlan(await api("plans/" + current.id));
        }
        if (s.purpose === "review") setPlan(await api("plans/" + s.target));
      } catch (e) {
        if (hadFragment) showError(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!pendingRequest || session?.purpose !== "workspace") return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api("assistant/" + pendingRequest);
        if (stopped) return;
        if (value.pending) {
          setAssistantProgress(value.progress || null);
          timer = setTimeout(poll, 700);
          return;
        }
        setReply(value.text);
        setAssistantProgress(null);
        setPendingRequest(null);
        setAssistantBusy(false);
        sessionStorage.removeItem("pw-request");
        if (value.error) setError(value.text);
        if (value.prepared?.plan) {
          setPlan(value.prepared.plan);
          setPage("home");
        }
      } catch (error) {
        if (stopped) return;
        showError(error);
        if (
          [401, 403, 404, 410].includes(
            (error as { status?: number }).status || 0,
          )
        ) {
          setPendingRequest(null);
          setAssistantBusy(false);
          sessionStorage.removeItem("pw-request");
          return;
        }
        timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pendingRequest, session?.purpose]);
  useEffect(() => {
    if (!plan || !["RUNNING", "PENDING"].includes(plan.status)) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const p = await api("plans/" + plan.id);
        if (stopped) return;
        setPlan(p);
        if (
          ["SUCCEEDED", "FAILED", "PARTIAL"].includes(p.status) &&
          session?.purpose === "workspace"
        )
          await refresh();
      } catch (e) {
        if (!stopped) showError(e);
      }
    }, 900);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [plan?.id, plan?.status, session?.purpose]);
  useEffect(() => {
    if (
      !plan ||
      !["SUCCEEDED", "PARTIAL"].includes(plan.status) ||
      shownResult.current === plan.id
    )
      return;
    const ids = plan.tasks.filter((t) => t.receipt).map((t) => t.receipt);
    if (!ids.length) return;
    shownResult.current = plan.id;
    let stopped = false;
    Promise.all(ids.map((id) => api("receipts/" + id)))
      .then((values) => {
        if (!stopped) {
          setReceiptGroup(values);
          setReceiptIndex(0);
          setReceipt(values[0]);
        }
      })
      .catch(() => {
        if (!stopped)
          setError(
            "Your completed tasks are confirmed. We could not load their receipts yet. Open a receipt from the task results to try again.",
          );
      });
    return () => {
      stopped = true;
    };
  }, [plan?.id, plan?.status]);
  async function guarded(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      showError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function openReceipt(id: string) {
    await guarded(async () => {
      setReceiptGroup([]);
      setReceiptIndex(0);
      setReceipt(await api("receipts/" + id));
    });
  }
  async function openGroup(ids: string[]) {
    await guarded(async () => {
      const values = await Promise.all(ids.map((id) => api("receipts/" + id)));
      setReceiptGroup(values);
      setReceiptIndex(0);
      setReceipt(values[0]);
    });
  }
  async function reviewTask(task: Item) {
    await guarded(async () => {
      const result = await api("plans", { tasks: [task] });
      setPlan(result.plan);
      setPage("home");
      setForm("");
      requestAnimationFrame(() =>
        document
          .querySelector(".plan-panel")
          ?.scrollIntoView({ block: "start" }),
      );
    });
  }
  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assistantBusy) return;
    const text = String(
      new FormData(event.currentTarget).get("message") || "",
    ).trim();
    if (!text) return;
    setAssistantBusy(true);
    setReply("");
    setAssistantProgress(null);
    setError("");
    const id = crypto.randomUUID();
    try {
      await api("assistant", { text, requestId: id });
      sessionStorage.setItem(
        "pw-request",
        JSON.stringify({ id, owner: session!.user.id }),
      );
      setPendingRequest(id);
    } catch (e) {
      showError(e);
      setAssistantBusy(false);
    }
  }
  const heading =
    page === "settings"
      ? "Make yourself at home."
      : page === "history"
        ? "Your activity"
        : page === "ajo"
          ? "Money grows together."
          : page === "savings"
            ? "Make room for what matters."
            : "Good to have you here.";
  if (loading)
    return (
      <main className="entry">
        <div className="brand">
          <img
            src="/paywella-logo.png"
            alt="PayWella"
            width={149}
            height={56}
          />
        </div>
        <LoaderCircle className="spin" />
        <p>Opening your secure space</p>
      </main>
    );
  if (!session)
    return (
      <div className="landing">
        <header>
          <a className="brand" href="/">
            <img
              src="/paywella-logo.png"
              alt="PayWella"
              width={149}
              height={56}
            />
          </a>
          <Theme value={theme} change={setTheme} />
        </header>
        <main>
          <div className="eyebrow">YOUR MONEY. YOUR PEOPLE.</div>
          <h1>
            Less back and forth.
            <br />
            <em>More moving forward.</em>
          </h1>
          <p>
            Payments, everyday savings and Ajo, brought together in one
            conversation.
          </p>
          <div className="intro-art" aria-hidden="true">
            <div className="art-ring" />
            <div className="art-card">
              <Sprout size={32} />
              <span>
                A little today.
                <br />
                <strong>A bigger tomorrow.</strong>
              </span>
            </div>
            <div className="art-check">
              <Check size={26} />
            </div>
          </div>
          <div className="secure-note">
            <ShieldCheck />
            <span>
              Open your private link from PayWella on WhatsApp to get started.
            </span>
          </div>
          {whatsappNumber && (
            <a
              className="primary"
              href={
                "https://wa.me/" +
                whatsappNumber +
                "?text=" +
                encodeURIComponent(
                  joinContext.invite
                    ? "I want to join Ajo with invitation " + joinContext.invite
                    : "Hi",
                )
              }
            >
              Open PayWella on WhatsApp
              <ArrowUpRight size={18} />
            </a>
          )}
          {error && <ErrorBox text={error} close={() => setError("")} />}
          <small className="test-note">
            Test environment. Financial services are simulated.
          </small>
        </main>
        <footer>Built for the way we move money.</footer>
      </div>
    );
  if (session.purpose === "setup")
    return (
      <div className="setup">
        <header>
          <span className="brand">
            <img
              src="/paywella-logo.png"
              alt="PayWella"
              width={149}
              height={56}
            />
          </span>
          <Theme value={theme} change={setTheme} />
        </header>
        <div className="setup-grid">
          <aside>
            <div className="eyebrow">YOUR NEXT CHAPTER</div>
            <h1>
              Your money.
              <br />
              All together.
            </h1>
            <p>
              Send money. Make steady savings. Keep your Ajo contributions
              clear.
            </p>
            <div className="setup-art">
              <Sprout size={100} />
              <div />
              <div />
            </div>
          </aside>
          <main>
            <div className="step-count">01 / YOUR ACCOUNT</div>
            <h2>Let’s get you started.</h2>
            <p>
              Choose the name on your account and a private transaction PIN.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void guarded(async () => {
                  const w = await api("setup", Object.fromEntries(data));
                  setWorkspace(w);
                  setSession({
                    ...session,
                    purpose: "workspace",
                    user: w.user,
                  });
                });
              }}
            >
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </label>
              <div className="field-row">
                <label>
                  4-digit PIN
                  <input
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm PIN
                  <input
                    name="confirmation"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    required
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <p className="privacy">
                <ShieldCheck size={16} /> Your PIN stays private. Never share it
                in a chat.
              </p>
              {error && <ErrorBox text={error} close={() => setError("")} />}
              <button className="primary" disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle className="spin" />
                    Opening your account
                  </>
                ) : (
                  <>
                    Open my account
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
            <small className="test-note">
              A test balance of ₦500,000 is credited once. No real bank account
              is opened.
            </small>
          </main>
        </div>
      </div>
    );
  const restricted = session.purpose === "review";
  return (
    <div className="shell">
      <aside className="sidebar">
        <span className="brand">
          <img
            src="/paywella-logo.png"
            alt="PayWella"
            width={149}
            height={56}
          />
        </span>
        <div className="nav-caption">YOUR EVERYDAY MONEY</div>
        <nav>
          {[
            ["home", "Overview", Wallet],
            ["savings", "Savings", Sprout],
            ["ajo", "Ajo", Users],
            ["history", "Activity", History],
            ["settings", "Settings", Settings],
          ].map(([key, label, C]: any) => (
            <button
              key={key}
              className={page === key ? "selected" : ""}
              onClick={() => {
                setPage(key);
                setError("");
              }}
              disabled={restricted}
            >
              <C size={21} />
              {label}
              <span className="nav-dot" />
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={26} />
          <strong>You’re in control.</strong>
          <p>Every payment needs your private approval.</p>
        </div>
        <small>FINANCIAL RAILS: SANDBOX</small>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="mobile-brand brand">
            <img
              src="/paywella-logo.png"
              alt="PayWella"
              width={149}
              height={56}
            />
          </span>
          <div className="greeting">
            {restricted
              ? "Secure review"
              : `Hello, ${workspace?.user?.name?.split(" ")[0] || "there"}`}
          </div>
          <WhatsAppLink number={whatsappNumber} compact />
          <Theme value={theme} change={setTheme} />
          <div className="avatar">{(session.user?.name || "P").charAt(0)}</div>
        </header>
        <main className="dashboard">
          <div className="page-top">
            <div>
              <span className="eyebrow">
                {page === "history"
                  ? "EVERY MOVE, CLEARLY"
                  : page === "ajo"
                    ? "INDIVIDUAL THRIFT"
                    : page === "savings"
                      ? "SMALL STEPS ADD UP"
                      : "ONE PLACE FOR YOUR MONEY"}
              </span>
              <h1>
                {restricted || (plan && page === "home")
                  ? plan?.spec.length === 1
                    ? "Review your transaction."
                    : "Your tasks, together."
                  : heading}
              </h1>
            </div>
            <span className="date">
              {new Date().toLocaleDateString("en-NG", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          {error && <ErrorBox text={error} close={() => setError("")} />}
          {!restricted && workspace && page === "home" && !plan && (
            <>
              <div className="overview-grid">
                <section className="balance-card">
                  <div className="balance-top">
                    <span>Available balance</span>
                    <span className="currency">NGN</span>
                  </div>
                  <h2>{money(workspace.availableKobo)}</h2>
                  <p>Your everyday money, ready when you are.</p>
                  <button onClick={() => setForm("bank_transfer")}>
                    <ArrowUpRight size={18} /> Send money
                  </button>
                  <button onClick={() => setForm("funding")}>
                    <Plus size={18} />
                    Account details
                  </button>
                  <div className="balance-orbit" aria-hidden="true" />
                </section>
                <section className="conversation-card">
                  <div className="card-icon">
                    <MessageCircle />
                  </div>
                  <div className="eyebrow">JUST ASK PAYWELLA</div>
                  <h2>
                    One message.
                    <br /> A few things done.
                  </h2>
                  <p>
                    Prepare payments and savings together. Check the details,
                    then approve once.
                  </p>
                  <form onSubmit={ask}>
                    <label className="sr-only" htmlFor="message">
                      Your request
                    </label>
                    <input
                      id="message"
                      name="message"
                      placeholder="What would you like to do?"
                      maxLength={2000}
                      required
                      disabled={assistantBusy}
                    />
                    <button
                      aria-label={
                        assistantBusy ? "Request processing" : "Send request"
                      }
                      disabled={assistantBusy}
                    >
                      {assistantBusy ? (
                        <LoaderCircle className="spin" size={20} />
                      ) : (
                        <ArrowRight size={20} />
                      )}
                    </button>
                  </form>
                  {reply && (
                    <>
                      <div className="assistant-reply">{reply}</div>
                      <button
                        type="button"
                        className="text-button"
                        disabled={assistantBusy || busy}
                        onClick={() =>
                          guarded(async () => {
                            await api("assistant/reset", {});
                            setReply("");
                          })
                        }
                      >
                        <Trash2 size={14} />
                        Clear conversation
                      </button>
                    </>
                  )}
                  {assistantBusy && (
                    <div role="status" aria-live="polite">
                      <p className="typing-copy">
                        PayWella is preparing your request…
                      </p>
                      <TaskProgress value={assistantProgress as any} />
                    </div>
                  )}
                  {whatsappNumber && (
                    <div className="whatsapp-entry">
                      <p>Prefer to speak? Send PayWella a voice note.</p>
                      <WhatsAppLink number={whatsappNumber} />
                    </div>
                  )}
                </section>
              </div>
              <section className="quick-actions">
                {[
                  ["bank_transfer", "To a bank", ArrowUpRight],
                  ["p2p", "To PayWella", Send],
                  ["service", "Pay a bill", Wallet],
                  ["goal_create", "Save money", Sprout],
                ].map(([key, label, C]: any) => (
                  <button key={key} onClick={() => setForm(key)}>
                    <span>
                      <C size={23} />
                    </span>
                    <strong>{label}</strong>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </section>
              <div className="section-heading">
                <h2>Recent activity</h2>
                <button
                  className="text-button"
                  onClick={() => setPage("history")}
                >
                  See all
                  <ArrowRight size={16} />
                </button>
              </div>
              <Transactions
                items={workspace.receipts.slice(0, 4)}
                open={openReceipt}
                group={openGroup}
              />
            </>
          )}
          {!restricted && workspace && page === "history" && (
            <>
              <p className="section-description">
                Receipts for completed tasks live here. Pending tasks stay in
                your active review until confirmed.
              </p>
              <StatementDownload />
              <Transactions
                items={workspace.receipts}
                open={openReceipt}
                group={openGroup}
              />
            </>
          )}
          {!restricted && workspace && page === "settings" && (
            <section className="settings-panel">
              <h2>Your preferences</h2>
              <label>
                Reply language
                <select
                  value={workspace.user.language}
                  disabled={busy}
                  onChange={(event) =>
                    guarded(async () => {
                      await api("settings", { language: event.target.value });
                      await refresh();
                    })
                  }
                >
                  <option value="en">English</option>
                  <option value="pcm">Nigerian Pidgin</option>
                  <option value="yo">Yorùbá</option>
                  <option value="ig">Igbo</option>
                  <option value="ha">Hausa</option>
                </select>
              </label>
              <p className="review-note">
                This sets the assistant’s preferred language. You can still
                switch languages in conversation. Web controls currently use
                English.
              </p>
              <label>
                Appearance
                <Theme value={theme} change={setTheme} />
              </label>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setForm("funding")}
              >
                Your account details
                <ArrowRight size={17} />
              </button>
            </section>
          )}
          {!restricted && workspace && page === "savings" && (
            <>
              <div className="section-heading">
                <h2>Your goals</h2>
                <button
                  className="text-button"
                  onClick={() => setForm("goal_create")}
                >
                  <Plus size={17} />
                  New goal
                </button>
              </div>
              <div className="goals">
                {workspace.goals.map((g: Item) => (
                  <section key={g.id} className="goal-card">
                    <div className="card-icon">
                      <Sprout />
                    </div>
                    <h2>{g.name}</h2>
                    <strong>{money(g.balanceKobo)}</strong>
                    <div className="goal-actions">
                      <button onClick={() => setForm("goal_deposit:" + g.id)}>
                        <Plus size={16} />
                        Add money
                      </button>
                      <button onClick={() => setForm("goal_withdraw:" + g.id)}>
                        <ArrowUpRight size={16} />
                        Withdraw
                      </button>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setForm("goal_schedule:" + g.id)}
                    >
                      Automate savings
                      <ArrowRight size={16} />
                    </button>
                  </section>
                ))}
              </div>
              {!!workspace.schedules?.length && (
                <>
                  <div className="section-heading">
                    <h2>Recurring savings</h2>
                  </div>
                  {[...workspace.schedules]
                    .sort((a: Item, b: Item) =>
                      b.authorizedAt.localeCompare(a.authorizedAt),
                    )
                    .slice(0, 10)
                    .map((schedule: Item) => (
                      <section className="member" key={schedule.id}>
                        <div>
                          <h3>{schedule.goalName}</h3>
                          <p>
                            {money(schedule.amountKobo)} {schedule.frequency} at
                            09:00 WAT
                          </p>
                          <p>
                            {schedule.status === "ACTIVE"
                              ? `Next ${schedule.nextDate} · Ends ${schedule.endDate}`
                              : schedule.status === "CANCELLED"
                                ? "Cancelled. Earlier savings are unchanged."
                                : "Completed."}
                          </p>
                        </div>
                        {schedule.status === "ACTIVE" && (
                          <div className="inline-actions">
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                setForm(
                                  "goal_schedule:" +
                                    schedule.goalId +
                                    ":" +
                                    schedule.id,
                                )
                              }
                            >
                              Change
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void guarded(async () => {
                                  await api(
                                    "savings/schedules/" +
                                      schedule.id +
                                      "/cancel",
                                    {},
                                  );
                                  await refresh();
                                })
                              }
                            >
                              Cancel future runs
                            </button>
                          </div>
                        )}
                      </section>
                    ))}
                  {workspace.savingsRuns
                    ?.filter((run: Item) => run.status !== "SETTLED")
                    .slice(0, 5)
                    .map((run: Item) => (
                      <p className="review-note" key={run.id}>
                        {run.status === "SKIPPED_INSUFFICIENT_FUNDS"
                          ? `Scheduled saving skipped on ${run.date}: available funds were too low.`
                          : `${run.missedRuns} missed saving runs skipped. No catch-up debit was made.`}
                      </p>
                    ))}
                </>
              )}
              {!workspace.goals.length && (
                <Empty
                  icon={Sprout}
                  title="Something worth saving for?"
                  text="Start a goal, choose an amount and build it at your own pace."
                  action={() => setForm("goal_create")}
                  actionText="Create a goal"
                />
              )}
            </>
          )}
          {!restricted && workspace && page === "ajo" && (
            <>
              <section className="ajo-intro">
                <Users size={30} />
                <div>
                  <h2>One circle. Different saving rhythms.</h2>
                  <p>
                    Each member has their own contribution amount and payout
                    date. Cash recorded stays separate from funded principal.
                  </p>
                </div>
              </section>
              {!workspace.user.organizer && (
                <section className="organizer-access">
                  <div className="section-heading">
                    <h2>Collect savings for your community?</h2>
                  </div>
                  {workspace.organizerApplications?.some(
                    (application: Item) => application.status === "PENDING",
                  ) ? (
                    <>
                      <p>
                        <Clock3 size={18} /> Your organizer application is in
                        review.
                      </p>
                      <small>
                        You can still join a book and manage your own savings
                        while you wait.
                      </small>
                    </>
                  ) : (
                    <>
                      <p>
                        Individuals and registered businesses can apply. Keep
                        your members’ cash records, funded savings and payouts
                        clear.
                      </p>
                      {workspace.organizerApplications?.find(
                        (application: Item) =>
                          application.status === "REJECTED",
                      ) && (
                        <p className="review-note">
                          Your last application needs an update:{" "}
                          {
                            workspace.organizerApplications
                              .filter(
                                (application: Item) =>
                                  application.status === "REJECTED",
                              )
                              .sort((a: Item, b: Item) =>
                                b.createdAt.localeCompare(a.createdAt),
                              )[0].reason
                          }
                        </p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setForm("organizer_application")}
                      >
                        Become an organizer <ArrowRight size={17} />
                      </button>
                    </>
                  )}
                </section>
              )}
              <div className="section-heading">
                <h2>Your collection books</h2>
                <div className="inline-actions">
                  <button
                    className="text-button"
                    onClick={() => setForm("ajo_join")}
                  >
                    Join a book
                  </button>
                  {!!workspace.user.organizer && (
                    <button
                      className="text-button"
                      onClick={() => setForm("ajo_book")}
                    >
                      <Plus size={16} />
                      Create book
                    </button>
                  )}
                </div>
              </div>
              {workspace.imports?.map((candidate: Item) => (
                <ImportReview
                  key={candidate.id}
                  candidate={candidate}
                  members={workspace.members.filter(
                    (member: Item) => member.organizer === workspace.user.id,
                  )}
                  busy={busy}
                  onPrepare={(tasks) =>
                    guarded(async () => {
                      const result = await api("plans", { tasks });
                      setPlan(result.plan);
                      setPage("home");
                    })
                  }
                />
              ))}
              {workspace.books.map((b: Item) => (
                <section className="book" key={b.id}>
                  <h3>{b.name}</h3>
                  <p>{feeDescription(b.feePolicy)}</p>
                  <div className="book-footer">
                    <span>
                      {b.inviteRevokedAt
                        ? "Invitation revoked"
                        : `Invitation: ${b.invite}`}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Copy invitation"
                      disabled={!!b.inviteRevokedAt}
                      onClick={() => {
                        navigator.clipboard
                          .writeText(
                            window.location.origin + "/?join=" + b.invite,
                          )
                          .catch(showError);
                      }}
                    >
                      <Copy size={18} />
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void guarded(async () => {
                          await api("ajo/books/" + b.id + "/invitation", {
                            action: "rotate",
                          });
                          await refresh();
                        })
                      }
                    >
                      New invitation
                    </button>
                    {!b.inviteRevokedAt && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void guarded(async () => {
                            await api("ajo/books/" + b.id + "/invitation", {
                              action: "revoke",
                            });
                            await refresh();
                          })
                        }
                      >
                        Revoke invitation
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => setForm("ajo_member:" + b.id)}
                    >
                      Add cash member
                      <Plus size={16} />
                    </button>
                  </div>
                </section>
              ))}
              {workspace.members.map((m: Item) => (
                <section className="member" key={m.id}>
                  <div>
                    <h3>{m.name}</h3>
                    <p>
                      {money(m.dailyKobo)} per day · Payout {m.maturityDate}
                    </p>
                    <p>
                      Funded {money(m.fundedKobo)} · Cash outstanding{" "}
                      {money(m.cashOutstandingKobo)}
                    </p>
                    <p>
                      Cycle fee {money(m.agreedFeeKobo || 0)} · Fee already
                      taken {money(m.feePaidKobo || 0)}
                    </p>
                    {m.contribution && (
                      <p>
                        {m.contribution.paidDays} of {m.contribution.totalDays}{" "}
                        days covered
                        {m.contribution.nextDate
                          ? ` · ${money(m.contribution.nextDayRemainingKobo)} remaining for ${m.contribution.nextDate}`
                          : " · All cycle contributions recorded"}
                      </p>
                    )}
                  </div>
                  <div className="inline-actions">
                    {m.userId === workspace.user.id && (
                      <button
                        className="text-button"
                        onClick={() => setForm("ajo_contribute:" + m.id)}
                      >
                        Contribute
                      </button>
                    )}
                    {!!workspace.user.organizer &&
                      m.organizer === workspace.user.id && (
                        <>
                          <button
                            className="text-button"
                            onClick={() => setForm("ajo_cash:" + m.id)}
                          >
                            Record cash
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setForm("ajo_replace:" + m.id)}
                          >
                            Fund cash
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setForm("ajo_payout:" + m.id)}
                          >
                            Payout
                          </button>
                        </>
                      )}
                  </div>
                </section>
              ))}
              {!workspace.members.length && !workspace.books.length && (
                <Empty
                  icon={Users}
                  title="Keep every contribution clear."
                  text="Join your organizer’s collection book using the invitation they shared."
                  action={() => setForm("ajo_join")}
                  actionText="Join a book"
                />
              )}
            </>
          )}
          {plan &&
            (page === "home" || restricted) &&
            (restricted || !["CANCELLED", "EXPIRED"].includes(plan.status)) && (
              <PlanView
                key={plan.id + ":" + plan.revision}
                plan={plan}
                busy={busy}
                restricted={restricted}
                edit={(tasks: Item[]) =>
                  guarded(async () => {
                    setPlan(
                      await api("plans/" + plan.id + "/edit", {
                        revision: plan.revision,
                        tasks,
                      }),
                    );
                  })
                }
                approve={(pin: string, standingConsent: boolean) =>
                  guarded(async () => {
                    try {
                      setPlan(
                        await api("plans/" + plan.id + "/approve", {
                          revision: plan.revision,
                          pin,
                          ...(standingConsent ? { standingConsent: true } : {}),
                        }),
                      );
                    } catch (error) {
                      const current = await api("plans/" + plan.id);
                      if (current.status === "READY") throw error;
                      setPlan(current);
                    }
                  })
                }
                cancel={() =>
                  guarded(async () => {
                    await api("plans/" + plan.id + "/cancel", {});
                    setPlan(restricted ? await api("plans/" + plan.id) : null);
                  })
                }
                openReceipt={openReceipt}
                dismiss={() => setPlan(null)}
              />
            )}
          <footer className="dashboard-footer">
            <ShieldCheck size={14} /> Private by design. Financial rails are
            simulated in this environment.
          </footer>
        </main>
      </div>
      {form === "organizer_application" && workspace && (
        <Modal
          label="Organizer application"
          close={() => {
            if (!lock.current) setForm("");
          }}
        >
          <OrganizerApplicationForm
            submit={async (input) => {
              await api("organizer/application", input);
              await refresh();
              setForm("");
            }}
          />
        </Modal>
      )}
      {form === "funding" && workspace && (
        <Modal label="Your account details" close={() => setForm("")}>
          <div className="funding-details">
            <span className="eyebrow">YOUR NAIRA ACCOUNT</span>
            <h2>Account details</h2>
            <p>{workspace.funding.name}</p>
            <strong className="funding-number">
              {workspace.funding.accountNumber}
            </strong>
            <p>{workspace.funding.bankName}</p>
            <p className="review-note">
              This test account already has an opening balance. Do not send real
              money to these details.
            </p>
          </div>
        </Modal>
      )}
      {form === "ajo_join" && workspace && (
        <Modal label="Join a collection book" close={() => setForm("")}>
          <AjoJoin
            invite={joinContext.invite}
            proposalId={joinContext.proposalId}
            submit={async (data) => {
              await api("ajo/join", data);
              await refresh();
              setForm("");
              setJoinContext({ invite: "", proposalId: null });
            }}
          />
        </Modal>
      )}
      {form &&
        form !== "funding" &&
        form !== "ajo_join" &&
        form !== "organizer_application" &&
        workspace && (
          <TaskForm
            type={form}
            w={workspace}
            close={() => setForm("")}
            add={reviewTask}
            save={async (path: string, data: unknown) => {
              await guarded(async () => {
                await api(path, data);
                await refresh();
                setForm("");
              });
            }}
            busy={busy}
            error={error}
          />
        )}
      {receipt && (
        <Receipt
          key={receipt.id}
          receipt={receipt}
          onSaved={() => {
            if (session.purpose === "workspace") void refresh().catch(() => {});
          }}
          close={() => {
            setReceipt(null);
            setReceiptGroup([]);
          }}
          pager={
            receiptGroup.length > 1 ? (
              <div className="receipt-pager">
                <button
                  className="icon-button"
                  aria-label="Previous receipt"
                  disabled={receiptIndex === 0}
                  onClick={() => {
                    setReceiptIndex(receiptIndex - 1);
                    setReceipt(receiptGroup[receiptIndex - 1]);
                  }}
                >
                  <ArrowLeft size={18} />
                </button>
                <span>
                  {receiptIndex + 1} / {receiptGroup.length}
                </span>
                <button
                  className="icon-button"
                  aria-label="Next receipt"
                  disabled={receiptIndex === receiptGroup.length - 1}
                  onClick={() => {
                    setReceiptIndex(receiptIndex + 1);
                    setReceipt(receiptGroup[receiptIndex + 1]);
                  }}
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}
function WhatsAppLink({
  number,
  compact = false,
}: {
  number: string | null;
  compact?: boolean;
}) {
  if (!number || !/^\d{8,15}$/.test(number)) return null;
  return (
    <a
      className={
        compact ? "whatsapp-link whatsapp-link-compact" : "whatsapp-link"
      }
      href={"https://wa.me/" + number + "?text=Hi"}
      aria-label="Open PayWella on WhatsApp"
    >
      <MessageCircle size={20} />
      {!compact && (
        <>
          <span>Open WhatsApp</span>
          <ArrowUpRight size={17} />
        </>
      )}
    </a>
  );
}
function Theme({
  value,
  change,
}: {
  value: string;
  change: (v: string) => void;
}) {
  return (
    <label className="theme-control">
      <Sun size={16} />
      <span className="sr-only">Appearance</span>
      <select
        aria-label="Appearance"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="system">Device</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
function StatementDownload() {
  const today = new Date().toISOString().slice(0, 10),
    [start, setStart] = useState(today.slice(0, 8) + "01"),
    [end, setEnd] = useState(today),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="statement-download"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const response = await fetch(
            "/api/statement.pdf?" + new URLSearchParams({ start, end }),
            { credentials: "same-origin" },
          );
          if (!response.ok) {
            const value = await response.json();
            throw Error(
              value.message ||
                "The statement could not download. Try a shorter period.",
            );
          }
          const url = URL.createObjectURL(await response.blob()),
            link = document.createElement("a");
          link.href = url;
          link.download = "PayWella-statement.pdf";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "The statement could not download.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2>Your account statement</h2>
        <p>Posted transactions, opening balance and closing balance.</p>
      </div>
      <div className="field-row">
        <label>
          From
          <input
            type="date"
            value={start}
            max={end}
            required
            disabled={busy}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={end}
            min={start}
            max={today}
            required
            disabled={busy}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button className="secondary" disabled={busy}>
        {busy ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <Download size={17} />
        )}{" "}
        {busy ? "Preparing statement" : "Download PDF"}
      </button>
    </form>
  );
}
function ErrorBox({ text, close }: { text: string; close: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <span>{text}</span>
      <button aria-label="Dismiss error" onClick={close}>
        <X size={18} />
      </button>
    </div>
  );
}
function Empty({ icon: C, title, text, action, actionText }: any) {
  return (
    <section className="empty">
      <div className="empty-symbol">
        <C size={35} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="text-button" onClick={action}>
          {actionText}
          <ArrowRight size={16} />
        </button>
      )}
    </section>
  );
}
function Transactions({
  items,
  open,
  group,
}: {
  items: Item[];
  open: (id: string) => void;
  group?: (ids: string[]) => void;
}) {
  const groups = Object.values(
    items.reduce<Record<string, Item[]>>((result, row) => {
      (result[row.planId || row.id] ||= []).push(row);
      return result;
    }, {}),
  );
  return (
    <section className="transactions">
      {!items.length ? (
        <Empty
          icon={History}
          title="Your next move starts here."
          text="Once a task is completed, you’ll find its receipt here."
        />
      ) : (
        groups.map((rows) => (
          <div className="activity-group" key={rows[0].planId || rows[0].id}>
            {rows.length > 1 && (
              <button
                className="activity-group-heading"
                onClick={() => group?.(rows.map((row) => row.id))}
              >
                <span>{rows.length} tasks approved together</span>
                <span>
                  View receipts
                  <ChevronRight size={14} />
                </span>
              </button>
            )}
            {rows.map((t) => (
              <button
                key={t.id}
                className="transaction-row"
                onClick={() => open(t.id)}
              >
                <span className="transaction-icon">
                  <Icon type={t.status} />
                </span>
                <div>
                  <strong>{t.label}</strong>
                  <span>
                    {t.destination || "Your account"} ·{" "}
                    {new Date(t.createdAt).toLocaleDateString("en-NG", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <strong className="transaction-amount">
                  {money(t.amountKobo)}
                </strong>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
function PlanView({
  plan,
  busy,
  approve,
  cancel,
  openReceipt,
  dismiss,
  restricted,
  edit,
}: any) {
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);
  const [scheduleConsent, setScheduleConsent] = useState(false);
  const hasSchedule = plan.spec.some(
    (task: Item) => task.input.kind === "goal_schedule",
  );
  useEffect(() => {
    setScheduleConsent(false);
    setPin("");
  }, [plan.id, plan.revision]);
  const ready = plan.status === "READY",
    running = ["RUNNING", "PENDING"].includes(plan.status),
    singleTransfer =
      plan.spec.length === 1 &&
      ["bank_transfer", "p2p"].includes(plan.spec[0].input.kind),
    cashOnly = plan.spec.every((task: Item) => task.input.kind === "ajo_cash"),
    total = plan.spec.reduce(
      (n: number, t: Item) => n + t.amountKobo + t.feeKobo,
      0,
    );
  return (
    <section className="plan-panel" aria-labelledby="review-title">
      <header>
        <div className="review-symbol">
          {ready ? (
            <ShieldCheck />
          ) : running ? (
            <LoaderCircle className="spin" />
          ) : (
            <CheckCheck />
          )}
        </div>
        <div>
          <span className="eyebrow">
            {ready
              ? "YOU HAVE THE FINAL SAY"
              : running
                ? "CHECKING EVERY TASK"
                : "YOUR TASK RESULTS"}
          </span>
          <h2 id="review-title">
            {ready
              ? singleTransfer
                ? "Confirm your transfer."
                : "Let’s check the details."
              : running
                ? singleTransfer
                  ? "Sending your money."
                  : "Your tasks are underway."
                : plan.status === "SUCCEEDED"
                  ? singleTransfer
                    ? "Transfer successful."
                    : "All done. Every task confirmed."
                  : plan.status === "PARTIAL"
                    ? "Some tasks need your attention."
                    : plan.status === "EXPIRED"
                      ? "This review has expired."
                      : plan.status === "CANCELLED"
                        ? "This review was cancelled."
                        : "These tasks were not completed."}
          </h2>
        </div>
        {!restricted && !ready && !running && (
          <button
            className="icon-button"
            aria-label="Close results"
            onClick={dismiss}
          >
            <X />
          </button>
        )}
      </header>
      {ready && editing ? (
        <PlanEditor
          plan={plan}
          busy={busy}
          save={edit}
          close={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="plan-steps">
            {plan.spec.map((t: Item, i: number) => {
              const result = plan.tasks.find((r: Item) => r.id === t.id);
              return (
                <div className="plan-task" key={t.id}>
                  <span className={"task-indicator " + (result?.status || "")}>
                    <Icon type={result?.status || "DRAFT"} />
                  </span>
                  <div>
                    <strong>{t.label}</strong>
                    <p>{t.destination}</p>
                    {t.input.kind === "ajo_payout" && (
                      <p>
                        Principal {money(t.amountKobo + t.feeKobo)} · Organizer
                        fee {money(t.feeKobo)} · Saver receives{" "}
                        {money(t.amountKobo)}
                      </p>
                    )}
                    {t.input.kind === "ajo_replace" && (
                      <p>
                        Funds an existing cash collection. No additional
                        contribution days.
                      </p>
                    )}
                    <span>
                      {ready
                        ? "Ready for your approval"
                        : result?.status === "SETTLED"
                          ? "Successfully completed"
                          : result?.status === "PENDING"
                            ? "Awaiting provider confirmation"
                            : result?.status === "QUEUED"
                              ? "Queued securely"
                              : result?.status === "FAILED"
                                ? "Not completed. No debit was posted."
                                : result?.status}
                    </span>
                  </div>
                  <div className="task-right">
                    <strong>{money(t.amountKobo)}</strong>
                    {result?.receipt && (
                      <button
                        className="text-button"
                        onClick={() => openReceipt(result.receipt)}
                      >
                        Receipt
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                  {t.allocation && <AllocationDetails value={t.allocation} />}
                  {t.savingsSchedule && (
                    <ScheduleDetails value={t.savingsSchedule} />
                  )}
                </div>
              );
            })}
          </div>
          {ready && (
            <>
              {singleTransfer && (
                <div className="transfer-fee">
                  <span>Transfer fee</span>
                  <strong>{money(plan.spec[0].feeKobo)}</strong>
                </div>
              )}
              <div className="review-total">
                <span>
                  {cashOnly
                    ? "Cash to record"
                    : singleTransfer
                      ? "Total amount"
                      : "Total task amounts"}
                </span>
                <strong>{money(total)}</strong>
              </div>
              <p className="review-note">
                {cashOnly
                  ? "No wallet debit. This records cash collected, not bank-settled savings."
                  : singleTransfer
                    ? "Confirm the recipient above. Your PIN authorizes this transfer."
                    : "Includes all reviewed task amounts. Check each direction above. Cash records do not debit your wallet; savings withdrawals return funds to it."}
              </p>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setPin("");
                  setEditing(true);
                }}
              >
                {singleTransfer ? "Edit transfer details" : "Edit these tasks"}
                <ArrowRight size={16} />
              </button>
              <form
                className="pin-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    busy ||
                    pin.length !== 4 ||
                    (hasSchedule && !scheduleConsent)
                  )
                    return;
                  const value = pin;
                  setPin("");
                  void approve(value, scheduleConsent);
                }}
              >
                {hasSchedule && (
                  <AgreementCheck
                    checked={scheduleConsent}
                    onChange={setScheduleConsent}
                  >
                    I authorize the recurring amounts and dates above, up to the
                    maximum shown. I can cancel future runs.
                  </AgreementCheck>
                )}
                <label htmlFor="approval-pin">
                  Your 4-digit transaction PIN
                </label>
                <input
                  id="approval-pin"
                  autoFocus
                  autoComplete="off"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  maxLength={4}
                  disabled={busy}
                  required
                />
                <div className="review-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={cancel}
                    disabled={busy}
                  >
                    Cancel review
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      pin.length !== 4 ||
                      (hasSchedule && !scheduleConsent)
                    }
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={18} />
                        Submitting securely
                      </>
                    ) : (
                      <>
                        {singleTransfer
                          ? "Send money"
                          : plan.spec.length > 1
                            ? "Approve all tasks"
                            : "Approve"}
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}
          {running && (
            <p className="pending-note">
              <Clock3 size={18} />
              You can leave and return. Your tasks keep running. Please don’t
              submit them again.
            </p>
          )}
          {["EXPIRED", "CANCELLED"].includes(plan.status) && (
            <p className="pending-note">
              <ShieldCheck size={18} />
              No task in this review was authorized. Return to PayWella on
              WhatsApp and ask for a fresh review when you’re ready.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function Modal({
  children,
  close,
  label,
}: {
  children: React.ReactNode;
  close: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close"
          onClick={close}
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}
function TaskForm({ type, w, close, add, save, busy, error }: any) {
  const [kind, id, replacesId] = type.split(":"),
    [selected, setSelected] = useState(w.products[0].id);
  const [bankCode, setBankCode] = useState(""),
    [accountNumber, setAccountNumber] = useState(""),
    [beneficiary, setBeneficiary] = useState("");
  const [feeKind, setFeeKind] = useState("none");
  const product = w.products.find((p: Item) => p.id === selected);
  const title: Record<string, string> = {
    bank_transfer: "Send to a bank",
    p2p: "Send to PayWella",
    service: "Pay a bill",
    goal_create: "Start a savings goal",
    goal_deposit: "Add to your goal",
    goal_withdraw: "Withdraw savings",
    goal_schedule: replacesId
      ? "Change recurring savings"
      : "Automate your savings",
    ajo_book: "Create a collection book",
    ajo_join: "Join a collection book",
    ajo_member: "Add a cash member",
    ajo_cash: "Record cash collected",
    ajo_replace: "Fund collected cash",
    ajo_contribute: "Make a contribution",
    ajo_payout: "Pay out funded savings",
  };
  return (
    <Modal label={title[kind]} close={close}>
      <div className="card-icon">
        <Icon type="DRAFT" />
      </div>
      <h2>{title[kind]}</h2>
      <p className="modal-description">
        {kind === "ajo_cash"
          ? "This records money held by the organizer. It does not credit the member’s funded balance."
          : kind.startsWith("ajo_")
            ? "Keep the member’s own contribution amount and payout date."
            : "Add the details. You’ll review and approve before any money moves."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget)),
            amountKobo = Math.round(Number(data.amount) * 100);
          if (kind === "ajo_book") {
            void save("ajo/books", {
              name: data.name,
              feePolicy:
                feeKind === "fixed"
                  ? {
                      kind: "fixed",
                      amountKobo: Math.round(Number(data.feeAmount) * 100),
                    }
                  : { kind: feeKind },
              ...(String(data.rules || "").trim()
                ? { rules: String(data.rules).trim() }
                : {}),
            });
            return;
          }
          if (kind === "ajo_member") {
            void save("ajo/members", {
              bookId: id,
              name: data.name,
              dailyKobo: amountKobo,
              maturityDate: data.maturityDate,
              startDate: data.startDate,
              consentConfirmed: data.consentConfirmed === "on",
            });
            return;
          }
          let task: Item = { kind, amountKobo };
          if (kind === "bank_transfer")
            task = {
              ...task,
              bankCode: data.bankCode,
              accountNumber: data.accountNumber,
            };
          if (kind === "p2p")
            task.recipientPhone = String(data.recipientPhone)
              .replace(/^0/, "234")
              .replace(/^\+/, "");
          if (kind === "goal_create") task.name = data.name;
          if (kind === "goal_deposit" || kind === "goal_withdraw")
            task.goalId = id;
          if (kind === "goal_schedule")
            task = {
              ...task,
              goalId: id,
              frequency: data.frequency,
              startDate: data.startDate,
              endDate: data.endDate,
              ...(replacesId ? { replacesId } : {}),
            };
          if (kind === "service")
            task = { ...task, productId: selected, customer: data.customer };
          if (kind.startsWith("ajo_")) {
            task.memberId = id;
            if (kind === "ajo_cash") task.date = data.date;
          }
          if (!busy) void add(task);
        }}
      >
        {(kind === "goal_create" ||
          kind === "ajo_book" ||
          kind === "ajo_member") && (
          <label>
            {kind === "goal_create"
              ? "Goal name"
              : kind === "ajo_member"
                ? "Member name"
                : "Collection book name"}
            <input name="name" required maxLength={60} />
          </label>
        )}
        {kind === "ajo_book" && (
          <>
            <label>
              Organizer fee per cycle
              <select
                value={feeKind}
                onChange={(event) => setFeeKind(event.target.value)}
              >
                <option value="none">No fee</option>
                <option value="one_day">One daily contribution</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>
            {feeKind === "fixed" && (
              <label>
                Fixed cycle fee (₦)
                <input
                  name="feeAmount"
                  type="number"
                  min="1"
                  max="1000000"
                  step="0.01"
                  required
                />
              </label>
            )}
            <label>
              Additional rules (optional)
              <input name="rules" maxLength={500} />
            </label>
            <p className="review-note">
              The fee is disclosed before a saver joins and deducted once from
              the first payout. Changing terms requires a new cycle.
            </p>
          </>
        )}
        {kind === "bank_transfer" && (
          <>
            {!!w.beneficiaries?.length && (
              <label>
                Saved recipient
                <select
                  value={beneficiary}
                  onChange={(event) => {
                    const recipient = w.beneficiaries.find(
                      (item: Item) => item.id === event.target.value,
                    );
                    setBeneficiary(event.target.value);
                    if (recipient) {
                      setBankCode(recipient.bankCode);
                      setAccountNumber(recipient.accountNumber);
                    }
                  }}
                >
                  <option value="">Choose a saved recipient</option>
                  {w.beneficiaries.map((recipient: Item) => (
                    <option key={recipient.id} value={recipient.id}>
                      {recipient.alias || recipient.name} ·{" "}
                      {recipient.accountNumber}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Bank
              <select
                name="bankCode"
                required
                value={bankCode}
                onChange={(event) => {
                  setBankCode(event.target.value);
                  setBeneficiary("");
                }}
              >
                <option value="" disabled>
                  Choose a bank
                </option>
                {w.banks.map((b: Item) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account number
              <input
                name="accountNumber"
                inputMode="numeric"
                pattern="[0-9]{10}"
                minLength={10}
                maxLength={10}
                required
                autoComplete="off"
                value={accountNumber}
                onChange={(event) => {
                  setAccountNumber(event.target.value.replace(/\D/g, ""));
                  setBeneficiary("");
                }}
              />
            </label>
          </>
        )}
        {kind === "p2p" && (
          <label>
            Recipient’s phone number
            <input
              name="recipientPhone"
              type="tel"
              required
              placeholder="08012345678"
            />
          </label>
        )}
        {kind === "service" && (
          <>
            <label>
              Service
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {w.products.map((p: Item) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {product.category === "electricity"
                ? "Prepaid meter number"
                : "Phone number"}
              <input
                name="customer"
                inputMode="numeric"
                required
                maxLength={30}
              />
            </label>
          </>
        )}
        {kind === "ajo_join" && (
          <label>
            Invitation code
            <input
              name="invite"
              required
              minLength={8}
              maxLength={8}
              autoComplete="off"
            />
          </label>
        )}
        {kind !== "ajo_book" && (
          <label>
            {kind === "ajo_join" || kind === "ajo_member"
              ? "Daily contribution (₦)"
              : kind === "goal_schedule"
                ? "Amount each time (₦)"
                : kind === "ajo_payout"
                  ? "Principal to pay out (₦)"
                  : "Amount (₦)"}
            <input
              key={selected}
              name="amount"
              type="number"
              inputMode="decimal"
              min={
                kind === "goal_create"
                  ? 0
                  : kind === "service"
                    ? product.min / 100
                    : 1
              }
              max={kind === "service" ? product.max / 100 : 1000000}
              step="0.01"
              required
              defaultValue={
                kind === "goal_schedule" && replacesId
                  ? w.schedules.find(
                      (schedule: Item) => schedule.id === replacesId,
                    )?.amountKobo / 100
                  : kind === "service" && product.min === product.max
                    ? product.min / 100
                    : undefined
              }
              readOnly={kind === "service" && product.min === product.max}
            />
          </label>
        )}
        {(kind === "ajo_join" || kind === "ajo_member") && (
          <label>
            First contribution date
            <input
              name="startDate"
              type="date"
              defaultValue={new Date(Date.now() + 3600000)
                .toISOString()
                .slice(0, 10)}
              required
            />
          </label>
        )}
        {(kind === "ajo_join" || kind === "ajo_member") && (
          <label>
            Agreed payout date
            <input
              name="maturityDate"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
        )}
        {kind === "goal_schedule" && (
          <>
            <label>
              How often
              <select
                name="frequency"
                defaultValue={
                  w.schedules?.find(
                    (schedule: Item) => schedule.id === replacesId,
                  )?.frequency || "daily"
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              First run
              <input
                name="startDate"
                type="date"
                min={new Date(Date.now() + 90000000).toISOString().slice(0, 10)}
                defaultValue={new Date(Date.now() + 90000000)
                  .toISOString()
                  .slice(0, 10)}
                required
              />
            </label>
            <label>
              Last run
              <input
                name="endDate"
                type="date"
                min={new Date(Date.now() + 90000000).toISOString().slice(0, 10)}
                defaultValue={new Date(Date.now() + 30 * 86400000 + 3600000)
                  .toISOString()
                  .slice(0, 10)}
                required
              />
            </label>
            <p>
              Runs at 09:00 WAT. You will review the amount, dates and maximum
              total before approving with your PIN. Missed or unfunded runs are
              skipped, with no catch-up debit.
            </p>
          </>
        )}
        {kind === "ajo_cash" && (
          <label>
            Date collected
            <input
              name="date"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
        )}
        {kind === "ajo_member" && (
          <>
            <p>
              {feeDescription(
                w.books.find((book: Item) => book.id === id)?.feePolicy,
              )}
            </p>
            <AgreementCheck name="consentConfirmed">
              I confirm this saver agreed to the collection rules, their daily
              amount, payout date and cycle fee. I am recording their consent.
            </AgreementCheck>
          </>
        )}
        {error && (
          <div className="error-box" role="alert">
            <span>{error}</span>
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" />
          ) : (
            <>
              {" "}
              {["ajo_join", "ajo_book", "ajo_member"].includes(kind)
                ? "Save details"
                : kind === "bank_transfer" || kind === "p2p"
                  ? "Review transfer"
                  : "Continue to review"}
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
function Receipt({
  receipt: r,
  close,
  pager,
  onSaved,
}: {
  receipt: Item;
  close: () => void;
  pager?: React.ReactNode;
  onSaved?: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal close={close} label="Transaction receipt">
      <div className="receipt">
        {pager}
        <div className="receipt-head">
          <span className="brand">
            <img
              src="/paywella-logo.png"
              alt="PayWella"
              width={149}
              height={56}
            />
          </span>
          <span className="receipt-check">
            <Check size={26} />
          </span>
          <p>
            {r.kind === "ajo_cash"
              ? "Cash recorded successfully"
              : r.kind === "goal_schedule"
                ? "Savings instruction saved"
                : "Successfully completed"}
          </p>
          <h2>
            {r.savingsSchedule
              ? money(r.savingsSchedule.amountKobo) +
                " " +
                r.savingsSchedule.frequency
              : money(r.amountKobo)}
          </h2>
          <span>{r.label}</span>
        </div>
        <div className="receipt-details">
          {[
            ...(r.recipient
              ? [
                  ["Recipient", r.recipient.name],
                  ["Bank", r.recipient.bankName],
                  ["Account number", r.recipient.accountNumber],
                ]
              : [["To", r.destination || "Your savings"]]),
            [r.feeLabel || "Fee", money(r.feeKobo)],
            ...(r.grossAmountKobo !== undefined
              ? [["Principal paid out", money(r.grossAmountKobo)]]
              : []),
            ["Date", new Date(r.createdAt).toLocaleString("en-NG")],
            ["Reference", r.reference],
            ...(r.electricityToken
              ? [["Electricity token", r.electricityToken]]
              : []),
          ].map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {r.allocation && <AllocationDetails value={r.allocation} />}
        {r.savingsSchedule && <ScheduleDetails value={r.savingsSchedule} />}
        <a className="primary" href={"/api/receipts/" + r.id + ".pdf"} download>
          <Download size={17} />
          Download receipt
        </a>
        {r.recipient && (
          <details className="save-recipient">
            <summary>
              {saved ? "Recipient saved" : "Save this recipient"}
            </summary>
            {!saved && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (saving) return;
                  const alias = String(
                    new FormData(event.currentTarget).get("alias") || "",
                  );
                  setSaving(true);
                  setError("");
                  try {
                    await api("receipts/" + r.id + "/save-recipient", {
                      alias,
                    });
                    setSaved(true);
                    onSaved?.();
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "The recipient could not be saved.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <label>
                  Save as (optional)
                  <input
                    name="alias"
                    maxLength={60}
                    placeholder="e.g. Mum"
                    disabled={saving}
                  />
                </label>
                {error && <p role="alert">{error}</p>}
                <button className="secondary" disabled={saving}>
                  {saving ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Check size={17} />
                  )}{" "}
                  {saving ? "Saving recipient" : "Save recipient"}
                </button>
              </form>
            )}
          </details>
        )}
        <small className="test-note">
          Financial rails are simulated. No real bank payment was sent.
        </small>
      </div>
    </Modal>
  );
}

function ScheduleDetails({ value }: { value: Item }) {
  return (
    <section className="schedule-terms">
      <strong>
        {money(value.amountKobo)} {value.frequency} for {value.goalName}
      </strong>
      <p>
        {value.startDate} to {value.endDate}, at 09:00 WAT.
      </p>
      <p>
        Up to {value.maximumRuns} runs. Maximum authorized:{" "}
        {money(value.maximumKobo)}. No one-off debit now.
      </p>
      <p>
        Missed or unfunded runs are skipped. Cancel future runs in Savings at
        any time.
      </p>
    </section>
  );
}
function AllocationDetails({ value }: { value: Item }) {
  const periods = value.periods as {
      date: string;
      amountKobo: number;
      remainingKobo: number;
    }[],
    first = periods[0],
    last = periods.at(-1);
  if (!first || !last) return null;
  return (
    <details className="allocation-details">
      <summary>
        {first.date === last.date
          ? first.date
          : `${first.date} to ${last.date}`}
        {` · ${periods.length} ${periods.length === 1 ? "date" : "dates"}`}
      </summary>
      <ul>
        {periods.map((period) => (
          <li key={period.date}>
            <span>{period.date}</span>
            <span>
              {money(period.amountKobo)}
              {period.remainingKobo
                ? ` · ${money(period.remainingKobo)} still due`
                : " · Day covered"}
            </span>
          </li>
        ))}
      </ul>
      <p>Collection dates are separate from confirmed bank funding.</p>
    </details>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
