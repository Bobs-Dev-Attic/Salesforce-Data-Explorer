import { getAdminClient } from "./supabase";

/**
 * Saved Data Explorer queries: the generated SOQL plus the full builder state
 * so a query can be reloaded and edited. Org-agnostic.
 */

export interface SavedQuery {
  id: string;
  name: string;
  object_name: string | null;
  soql: string;
  builder_state: unknown;
  updated_at?: string;
}

/** Postgres "relation does not exist" — table not migrated yet. */
export function isMissingTableError(message: string): boolean {
  return /relation .*saved_queries.* does not exist|Could not find the table/i.test(
    message
  );
}

export async function listSavedQueries(): Promise<SavedQuery[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("saved_queries")
    .select("id, name, object_name, soql, builder_state, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as SavedQuery[]) ?? [];
}

export async function saveQuery(params: {
  name: string;
  objectName: string | null;
  soql: string;
  builderState: unknown;
}): Promise<SavedQuery> {
  const supabase = getAdminClient();
  const row = {
    name: params.name,
    object_name: params.objectName,
    soql: params.soql,
    builder_state: params.builderState as object,
    updated_at: new Date().toISOString(),
  };
  // Upsert by unique name so re-saving the same name overwrites.
  const { data: existing } = await supabase
    .from("saved_queries")
    .select("id")
    .eq("name", params.name)
    .maybeSingle();

  const q = existing?.id
    ? supabase
        .from("saved_queries")
        .update(row)
        .eq("id", existing.id)
        .select("id, name, object_name, soql, builder_state, updated_at")
        .single()
    : supabase
        .from("saved_queries")
        .insert(row)
        .select("id, name, object_name, soql, builder_state, updated_at")
        .single();

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as SavedQuery;
}

export async function deleteSavedQuery(id: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.from("saved_queries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
