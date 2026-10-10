// PostgREST returns an empty body for SQL functions returning void.
// A successful usage update must not discard a completed Gemini response.
export async function readQuotaResponse(response) {
  if (!response.ok) throw new Error('Usage store unavailable');
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
