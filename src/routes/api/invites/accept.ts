import type { APIEvent } from "@solidjs/start/server";
import { acceptInviteSchema } from "~/lib/schemas";
import { apiErrorResponse, assertSameOrigin } from "~/server/api-helpers";
import { completeUserInvite } from "~/server/auth";
import { consumeRateLimit, extractClientIp } from "~/server/rate-limit";

export async function POST(event: APIEvent) {
  try {
    assertSameOrigin(event);
    const clientIp = extractClientIp(event.request.headers, event.clientAddress);
    const rate = consumeRateLimit(`invite_accept:${clientIp}`, 15, 15 * 60 * 1000);
    if (!rate.allowed) {
      throw new Error("RATE_LIMITED: Too many onboarding attempts. Please wait a few minutes.");
    }
    const formData = await event.request.formData();
    const parsed = acceptInviteSchema.safeParse({
      token: String(formData.get("token") ?? ""),
      fullName: String(formData.get("fullName") ?? ""),
      title: String(formData.get("title") ?? ""),
      password: String(formData.get("password") ?? "")
    });

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid onboarding fields." },
        { status: 400 }
      );
    }

    const avatarEntry = formData.get("avatar");
    const avatarFile = avatarEntry instanceof File && avatarEntry.size > 0 ? avatarEntry : null;

    const user = await completeUserInvite({
      ...parsed.data,
      avatarFile
    });

    return Response.json({ ok: true, user });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
