import { BrainCircuit, Check, LoaderCircle, ShieldCheck } from "lucide-react";
type Progress = {
  stage: string;
  detail?: string;
  taskCount?: number;
  tasks?: { label: string; status: string }[];
};
export function TaskProgress({ value }: { value: Progress | null }) {
  const label =
    value?.detail ||
    {
      listening: "Listening to your voice note",
      reading: "Reading your picture",
      checking: "Checking your tasks",
      ready: "Ready for your private approval",
      understanding: "Understanding your request",
    }[value?.stage || "understanding"];
  return (
    <section
      className="task-progress"
      aria-live="polite"
      aria-label="Request progress"
    >
      <div className="progress-brain">
        <BrainCircuit size={25} />
      </div>
      <strong>{label}</strong>
      {value?.tasks?.length ? (
        <>
          <div className="progress-trunk" aria-hidden="true" />
          <div className="progress-nodes">
            {value.tasks.map((task, index) => (
              <div className={"progress-node " + task.status} key={index}>
                {task.status === "ready" ? (
                  <Check size={17} />
                ) : (
                  <LoaderCircle size={17} className="spin" />
                )}
                <span>{task.label}</span>
              </div>
            ))}
          </div>
          <small>
            {value.tasks.filter((task) => task.status === "ready").length} of{" "}
            {value.taskCount} tasks checked
          </small>
        </>
      ) : (
        <div className="progress-pulse" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      <p>
        <ShieldCheck size={14} />
        Nothing moves before your approval.
      </p>
    </section>
  );
}
