import type { APIEvent } from "@solidjs/start/server";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { requireUser, updateOwnProfile } from "~/server/auth";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const currentUser = await requireUser();
    const formData = await event.request.formData();

    const fullName = String(formData.get("fullName") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const avatarEntry = formData.get("avatar");
    const avatarFile = avatarEntry instanceof File && avatarEntry.size > 0 ? avatarEntry : null;

    if (fullName.length < 2) {
      return Response.json({ error: "Full name must be at least 2 characters." }, { status: 400 });
    }
    if (title.length < 2) {
      return Response.json({ error: "Team title must be at least 2 characters." }, { status: 400 });
    }

    const updated = await updateOwnProfile({
      userId: currentUser.id,
      fullName,
      title,
      avatarFile,
      currentPassword: currentPassword || undefined,
      newPassword: newPassword || undefined
    });

    return Response.json({ ok: true, user: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
