// Marks a VIDEO content row that was created automatically from a live
// class recording (source === "RECORDING"), as opposed to one an admin
// uploaded directly. Shown next to ContentTypeBadge wherever admins list
// content, so it's clear at a glance why the "Video file" replace-upload
// control is hidden for that item in the edit form.
export default function LiveRecordingBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium tracking-wide text-red-600 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Live recording
    </span>
  );
}
