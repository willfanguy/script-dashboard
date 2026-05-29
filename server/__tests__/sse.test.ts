import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createSse } from "../sse.js";

// A minimal SSE client double: captures the `close` handler so the test can
// fire it, and lets the test make write() throw to simulate a dead socket.
function mockClient() {
  let closeCb: () => void = () => {};
  const res = {
    writeHead: vi.fn(),
    write: vi.fn(),
  } as unknown as Response;
  const req = {
    on: (event: string, cb: () => void) => {
      if (event === "close") closeCb = cb;
    },
  } as unknown as Request;
  return { req, res, fireClose: () => closeCb() };
}

const writeMock = (res: Response) => res.write as unknown as ReturnType<typeof vi.fn>;

describe("createSse", () => {
  it("broadcast is a no-op with no clients", () => {
    const sse = createSse();
    expect(() => sse.broadcast()).not.toThrow();
  });

  it("sets SSE headers on connect and writes a data frame on broadcast", () => {
    const sse = createSse();
    const c = mockClient();
    sse.handler(c.req, c.res);
    expect(c.res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    sse.broadcast();
    expect(writeMock(c.res)).toHaveBeenCalledWith(
      expect.stringContaining("data:"),
    );
  });

  it("drops a client whose write throws, still reaches the others, and never touches the dead one again", () => {
    const sse = createSse();
    const dead = mockClient();
    const live = mockClient();
    sse.handler(dead.req, dead.res); // handshake write succeeds
    sse.handler(live.req, live.res);

    writeMock(dead.res).mockImplementation(() => {
      throw new Error("EPIPE"); // socket gone before `close` fired
    });
    expect(() => sse.broadcast()).not.toThrow();
    expect(writeMock(live.res)).toHaveBeenCalledWith(
      expect.stringContaining("data:"),
    );

    // Dead client was removed: a second broadcast must not write to it again.
    writeMock(dead.res).mockClear();
    sse.broadcast();
    expect(writeMock(dead.res)).not.toHaveBeenCalled();
  });

  it("removes a client when its connection closes", () => {
    const sse = createSse();
    const c = mockClient();
    sse.handler(c.req, c.res);
    c.fireClose();
    writeMock(c.res).mockClear();
    sse.broadcast();
    expect(writeMock(c.res)).not.toHaveBeenCalled();
  });
});
