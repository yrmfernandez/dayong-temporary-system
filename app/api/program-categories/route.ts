import { canManageConfiguration, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { createProgramCategory, deleteProgramCategory, getProgramCategories, updateProgramCategory } from "@/lib/program-categories";

const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, error: error instanceof Error ? error.message : fallback }, { status });

/** Program categories are reference data for every signed-in role; only configuration managers change them. */
export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, error: "Please sign in." }, { status: 401 });
  try { return Response.json({ success: true, categories: await getProgramCategories(), canManage: await canManageConfiguration() }); }
  catch (error) { return failure(error, "Unable to load program categories.", 500); }
}

export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageConfiguration())) return Response.json({ success: false, error: "You are not allowed to manage program categories." }, { status: 403 });
  try { return Response.json({ success: true, ...await createProgramCategory(await request.json()) }, { status: 201 }); }
  catch (error) { return failure(error, "Unable to add the category."); }
});

export const PUT = withEncoder(async (request: Request) => {
  if (!(await canManageConfiguration())) return Response.json({ success: false, error: "You are not allowed to manage program categories." }, { status: 403 });
  try { return Response.json({ success: true, ...await updateProgramCategory(new URL(request.url).searchParams.get("id") ?? "", await request.json()) }); }
  catch (error) { return failure(error, "Unable to update the category."); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageConfiguration())) return Response.json({ success: false, error: "You are not allowed to manage program categories." }, { status: 403 });
  try { return Response.json({ success: true, ...await deleteProgramCategory(new URL(request.url).searchParams.get("id") ?? "") }); }
  catch (error) { return failure(error, "Unable to delete the category."); }
});
