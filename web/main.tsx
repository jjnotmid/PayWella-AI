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
} from "lucide-react";
import "./style.css";

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
    }),
    value = await response.json();
  if (!response.ok)
    throw new Error(
      value.message || "We could not complete that step. Please try again.",
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
    [plan, setPlan] = useState<Plan | null>(null),
    [receipt, setReceipt] = useState<Item | null>(null),
    [receiptGroup, setReceiptGroup] = useState<Item[]>([]),
    [receiptIndex, setReceiptIndex] = useState(0),
    [form, setForm] = useState(""),
    [drafts, setDrafts] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [theme, setTheme] = useState(initialTheme),
    [reply, setReply] = useState(""),
    [assistantBusy, setAssistantBusy] = useState(false);
  const lock = useRef(false),
    shownResult = useRef("");
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
    let mounted = true;
    const hadFragment = !!window.location.hash.slice(1);
    (async () => {
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
  async function prepare() {
    await guarded(async () => {
      const result = await api("plans", { tasks: drafts });
      setPlan(result.plan);
      setPage("home");
      setDrafts([]);
      setForm("");
    });
  }
  async function openReceipt(id: string) {
    await guarded(async () => {
      setReceiptGroup([]);
      setReceiptIndex(0);
      setReceipt(await api("receipts/" + id));
    });
  }
  function addTask(task: Item) {
    if (drafts.length >= 5) {
      setError("You can review up to five tasks together.");
      return;
    }
    setDrafts((v) => [...v, task]);
    setForm("");
  }
  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assistantBusy) return;
    const text = String(
      new FormData(event.currentTarget).get("message") || "",
    ).trim();
    if (!text) return;
    setAssistantBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      await api("assistant", { text, requestId: id });
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((r) => setTimeout(r, 700));
        const value = await api("assistant/" + id);
        if (!value.pending) {
          setReply(value.text);
          if (value.prepared?.plan) setPlan(value.prepared.plan);
          setAssistantBusy(false);
          return;
        }
      }
      throw new Error(
        "Your request is still processing. It is saved, so please check back before sending it again.",
      );
    } catch (e) {
      showError(e);
    } finally {
      setAssistantBusy(false);
    }
  }
  const heading =
    page === "history"
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
                  ? "Your tasks, together."
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
                  <div className="balance-orbit" aria-hidden="true" />
                </section>
                <section className="conversation-card">
                  <div className="card-icon">
                    <MessageCircle />
                  </div>
                  <div className="eyebrow">JUST ASK PAYWELLA</div>
                  <h2>
                    One message.
                    <br />A few things done.
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
                    <button aria-label="Send request" disabled={assistantBusy}>
                      {assistantBusy ? (
                        <LoaderCircle className="spin" size={19} />
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
                    <div className="assistant-progress">
                      <span />
                      <span />
                      <span />
                      Preparing your request
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
              />
            </>
          )}
          {!restricted && workspace && page === "history" && (
            <>
              <p className="section-description">
                Receipts for completed tasks live here. Pending tasks stay in
                your active review until confirmed.
              </p>
              <Transactions items={workspace.receipts} open={openReceipt} />
            </>
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
                  </section>
                ))}
              </div>
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
              {workspace.books.map((b: Item) => (
                <section className="book" key={b.id}>
                  <h3>{b.name}</h3>
                  <div className="book-footer">
                    <span>Invitation: {b.invite}</span>
                    <button
                      className="icon-button"
                      aria-label="Copy invitation"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(b.invite)
                          .catch(showError);
                      }}
                    >
                      <Copy size={18} />
                    </button>
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
                    {!!workspace.user.organizer && (
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
          {drafts.length > 0 && (
            <section className="draft-tray">
              <div>
                <strong>
                  {drafts.length} {drafts.length === 1 ? "task" : "tasks"} ready
                  to review
                </strong>
                <span>Nothing moves until you approve.</span>
              </div>
              <button className="text-button" onClick={() => setDrafts([])}>
                Clear
              </button>
              <button className="primary" onClick={prepare} disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <>
                    Review together
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </section>
          )}
          {plan &&
            (page === "home" || restricted) &&
            !["CANCELLED", "EXPIRED"].includes(plan.status) && (
              <PlanView
                plan={plan}
                busy={busy}
                restricted={restricted}
                approve={(pin: string) =>
                  guarded(async () => {
                    setPlan(
                      await api("plans/" + plan.id + "/approve", {
                        revision: plan.revision,
                        pin,
                      }),
                    );
                  })
                }
                cancel={() =>
                  guarded(async () => {
                    await api("plans/" + plan.id + "/cancel", {});
                    setPlan(null);
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
      {form && workspace && (
        <TaskForm
          type={form}
          w={workspace}
          close={() => setForm("")}
          add={addTask}
          save={async (path: string, data: unknown) => {
            await guarded(async () => {
              await api(path, data);
              await refresh();
              setForm("");
            });
          }}
          busy={busy}
        />
      )}
      {receipt && (
        <Receipt
          receipt={receipt}
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
}: {
  items: Item[];
  open: (id: string) => void;
}) {
  return (
    <section className="transactions">
      {!items.length ? (
        <Empty
          icon={History}
          title="Your next move starts here."
          text="Once a task is completed, you’ll find its receipt here."
        />
      ) : (
        items.map((t) => (
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
}: any) {
  const [pin, setPin] = useState("");
  const ready = plan.status === "READY",
    running = ["RUNNING", "PENDING"].includes(plan.status),
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
              ? "Let’s check the details."
              : running
                ? "Your tasks are underway."
                : plan.status === "SUCCEEDED"
                  ? "All done. Every task confirmed."
                  : plan.status === "PARTIAL"
                    ? "Some tasks need your attention."
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
            </div>
          );
        })}
      </div>
      {ready && (
        <>
          <div className="review-total">
            <span>Total task amounts</span>
            <strong>{money(total)}</strong>
          </div>
          <p className="review-note">
            Includes all reviewed task amounts. Savings withdrawals move money
            back to your wallet. Confirm the individual directions above.
          </p>
          <form
            className="pin-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || pin.length !== 4) return;
              const value = pin;
              setPin("");
              void approve(value);
            }}
          >
            <label htmlFor="approval-pin">Your 4-digit transaction PIN</label>
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
              <button className="primary" disabled={busy || pin.length !== 4}>
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={18} />
                    Submitting securely
                  </>
                ) : (
                  <>
                    Approve {plan.spec.length > 1 ? "all tasks" : "task"}
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
          You can leave and return. Your tasks keep running. Please don’t submit
          them again.
        </p>
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
function TaskForm({ type, w, close, add, save, busy }: any) {
  const [kind, id] = type.split(":"),
    [selected, setSelected] = useState(w.products[0].id);
  const product = w.products.find((p: Item) => p.id === selected);
  const title: Record<string, string> = {
    bank_transfer: "Send to a bank",
    p2p: "Send to PayWella",
    service: "Pay a bill",
    goal_create: "Start a savings goal",
    goal_deposit: "Add to your goal",
    goal_withdraw: "Withdraw savings",
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
            void save("ajo/books", { name: data.name });
            return;
          }
          if (kind === "ajo_join") {
            void save("ajo/join", {
              invite: String(data.invite).trim(),
              dailyKobo: amountKobo,
              maturityDate: data.maturityDate,
            });
            return;
          }
          if (kind === "ajo_member") {
            void save("ajo/members", {
              bookId: id,
              name: data.name,
              dailyKobo: amountKobo,
              maturityDate: data.maturityDate,
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
          if (kind === "service")
            task = { ...task, productId: selected, customer: data.customer };
          if (kind.startsWith("ajo_")) {
            task.memberId = id;
            if (kind === "ajo_cash") task.date = data.date;
          }
          add(task);
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
        {kind === "bank_transfer" && (
          <>
            <label>
              Bank
              <select name="bankCode" required defaultValue="">
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
                kind === "service" && product.min === product.max
                  ? product.min / 100
                  : undefined
              }
              readOnly={kind === "service" && product.min === product.max}
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
        <button className="primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" />
          ) : (
            <>
              {" "}
              {["ajo_join", "ajo_book", "ajo_member"].includes(kind)
                ? "Save details"
                : "Add to review"}
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
}: {
  receipt: Item;
  close: () => void;
  pager?: React.ReactNode;
}) {
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
          <p>Successfully completed</p>
          <h2>{money(r.amountKobo)}</h2>
          <span>{r.label}</span>
        </div>
        <div className="receipt-details">
          {[
            ["To", r.destination || "Your savings"],
            ["Fee", money(r.feeKobo)],
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
        <a className="primary" href={"/api/receipts/" + r.id + ".pdf"} download>
          <Download size={17} />
          Download receipt
        </a>
        <small className="test-note">
          Financial rails are simulated. No real bank payment was sent.
        </small>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
