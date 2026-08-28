import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";
import MeetingRoom, { type MeetingInfo } from "../components/meeting/MeetingRoom";
import { MeetingRoomSkeletonShell } from "../components/common/PageSkeletons";

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<{ token: string; wsUrl: string; meeting: MeetingInfo } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiRequest<{ token: string; wsUrl: string; meeting: MeetingInfo }>(`/meetings/${id}/token`)
      .then(setSession)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not join the meeting."));
  }, [id]);

  if (session) {
    return <MeetingRoom token={session.token} wsUrl={session.wsUrl} meeting={session.meeting} isAdmin={user?.role === "ADMIN"} onLeave={() => navigate(user?.role === "ADMIN" ? "/admin" : "/dashboard", { replace: true })} />;
  }

  // While the join token is still loading, show a skeleton shaped like the
  // real meeting room (dark header, tile grid, control bar) instead of a
  // generic light-mode card — avoids a jarring light-to-dark flash and a
  // full layout reflow the instant the room actually mounts.
  if (!error) {
    return <MeetingRoomSkeletonShell />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-5">
      <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white">
        <h1 className="font-display text-xl font-semibold">Unable to join</h1>
        <p className="mt-2 text-sm text-white/60">{error}</p>
        <button onClick={() => navigate(-1)} className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-semibold text-ink-950">Go back</button>
      </div>
    </div>
  );
}
