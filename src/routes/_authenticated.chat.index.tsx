// @ts-nocheck
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getMe } from "@/lib/auth.functions";
import { getDashboard, createThread } from "@/lib/tutor.functions";

/**
 * /chat — bootstrap route.
 * Sends user to their most recent session, or creates a fresh one.
 * Pure UI routing — internal memory architecture unchanged.
 */
export const Route = createFileRoute("/_authenticated/chat/")({
  ssr: false,
  beforeLoad: async () => {
    const me = await getMe().catch(() => null);
    if (!me?.student) throw redirect({ to: "/auth" });
    const dash = await getDashboard({ data: { studentId: me.student.id } });
    const latest = dash.threads?.[0];
    if (latest) {
      throw redirect({ to: "/chat/$threadId", params: { threadId: latest.id } });
    }
    const t = await createThread({ data: { studentId: me.student.id } });
    throw redirect({ to: "/chat/$threadId", params: { threadId: t.id } });
  },
  component: () => null,
});
