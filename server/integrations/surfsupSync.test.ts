import { describe, it, expect } from "vitest";
import { surfsupSyncHandler } from "./surfsupSync.js";

describe("surfsupSyncHandler (stub)", () => {
  it("aceita payload e responde 202 com ok:true", async () => {
    const req: any = { body: { rentals: [{ id: "X-1" }], boards: [] } };
    let status = 0;
    let body: any = null;
    const res: any = {
      status(c: number) {
        status = c;
        return this;
      },
      json(b: any) {
        body = b;
        return this;
      },
    };
    await surfsupSyncHandler(req, res);
    expect(status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
  });
});
