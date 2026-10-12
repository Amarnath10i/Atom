/**
 * How a student's mastery numbers are produced, with the evidence.
 *
 * Topics with graded answers get the learned student model's probability of
 * a right answer (agents/student_model.py); topics only discussed in chat keep
 * an estimate. The evaluation numbers come from the exported model itself
 * (agents/models/student_model.json), so the card can't drift from what ships.
 */
import { Gauge, CalendarClock, MessageSquare } from "lucide-react";

type Interval = [number, number, number];
type Scores = { name: string; auc: Interval; log_loss: Interval; brier: number; ece: number };

export type StudentModelCardData =
  | { available: false }
  | {
      available: true;
      trees: number;
      trained_on: string;
      evaluation: {
        test_students: number;
        test_attempts: number;
        shipped: Scores;
        atom_rule_before: Scores;
        atom_rule_as_displayed: Scores;
        best_model: Scores;
      };
    };

type AtomLike = {
  id: string;
  topic: string;
  subject: string;
  strength: number;
  mastery_source?: string | null;
  next_review_at?: string | null;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const DAY = 86_400_000;

export function StudentModelCard({ card, atoms }: { card: StudentModelCardData; atoms: AtomLike[] }) {
  const modelled = atoms.filter((a) => a.mastery_source === "model");
  const estimated = atoms.length - modelled.length;
  const due = modelled
    .filter((a) => a.next_review_at)
    .map((a) => ({ ...a, inDays: (new Date(a.next_review_at as string).getTime() - Date.now()) / DAY }))
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, 6);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Gauge className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">How your mastery is measured</h2>
      </div>

      {!card.available ? (
        <p className="text-sm text-muted-foreground">
          The learned student model isn't reachable right now, so mastery comes from the earlier rules.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            After a mock test, each topic's mastery is the chance you'd answer a medium question on it correctly, from
            a model trained on {card.trained_on.split(":")[0]} and checked on{" "}
            {card.evaluation.test_students.toLocaleString()} students it never saw. It reads your answers on the
            topic and its unit, how long they took, how hard they were and how long ago you practised.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Ranks right vs wrong answers (AUC)"
              value={card.evaluation.shipped.auc[0].toFixed(3)}
              note={`earlier rule: ${card.evaluation.atom_rule_before.auc[0].toFixed(3)}`}
            />
            <Stat
              label="Average gap between shown mastery and actual accuracy"
              value={pct(card.evaluation.shipped.ece)}
              note={`earlier rule as shown: ${pct(card.evaluation.atom_rule_as_displayed.ece)}`}
            />
            <Stat
              label="Your topics scored from graded answers"
              value={`${modelled.length}`}
              note={`${estimated} more estimated from conversation`}
            />
          </div>
        </>
      )}

      {due.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4" /> Next reviews (when recall is predicted to fall to 90%, from a forgetting curve fitted on 10M scheduled vocabulary reviews)
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {due.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                <span>
                  {a.topic} <span className="text-xs text-muted-foreground">· {a.subject}</span>
                </span>
                <span className={a.inDays <= 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {a.inDays <= 0 ? "due now" : `in ${Math.ceil(a.inDays)} d`} · {pct(a.strength)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {estimated > 0 && card.available && (
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Topics you've only discussed in chat have no graded answers yet; their mastery is the tutor's estimate.
          Take a mock test on them to get a measured one.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{note}</div>
    </div>
  );
}
