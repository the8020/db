/** Test-only transport; all schema and SQL behavior comes from ordinary sources. */
import {
  kernelDatabaseBackendSymbol,
  kernelInvokeSymbol,
} from "@the8020/kernel";
import schema from "./schema.ts";

if (import.meta.main) {
  const [url, backend, scope] = Deno.args;
  const globals = globalThis as unknown as Record<symbol, unknown>;
  globals[kernelDatabaseBackendSymbol] = backend;
  globals[kernelInvokeSymbol] = async (operation: string, input: unknown) => {
    const result = await fetch(url!, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Scope": scope! },
      body: JSON.stringify({ operation, input }),
    });
    if (!result.ok) throw new Error((await result.text()).trim());
    return await result.json();
  };
  const input = JSON.parse(await new Response(Deno.stdin.readable).text());
  console.log(JSON.stringify(await schema(input)));
}
