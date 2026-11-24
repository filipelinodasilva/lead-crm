import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/automations/admin-client", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/automations/meta-send", () => ({ engineSendText: vi.fn() }));
vi.mock("@/lib/whatsapp/connections", () => ({ getConnectionForConversation: vi.fn() }));

const { buildMenu, isOpenNow, parseAutomation, parseMenuChoice, parseRating, renderText } = await import("./automation");

describe("atendimento automático (funções puras)", () => {
  it("horário no fuso da conta", () => {
    const s = { days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };
    // 2026-11-11 (quarta) 12:00 UTC = 09:00 em São Paulo
    expect(isOpenNow(s, "America/Sao_Paulo", new Date("2026-11-11T12:00:00Z"))).toBe(true);
    // 22:00 UTC = 19:00 em SP: fechado
    expect(isOpenNow(s, "America/Sao_Paulo", new Date("2026-11-11T22:00:00Z"))).toBe(false);
    // sábado
    expect(isOpenNow(s, "America/Sao_Paulo", new Date("2026-11-14T15:00:00Z"))).toBe(false);
    // horário vazio = sempre aberto
    expect(isOpenNow({}, "America/Sao_Paulo")).toBe(true);
  });

  it("escolha do menu e nota", () => {
    expect(parseMenuChoice(" 2 ", 3)).toBe(1);
    expect(parseMenuChoice("2.", 3)).toBe(1);
    expect(parseMenuChoice("4", 3)).toBeNull();
    expect(parseMenuChoice("quero vendas", 3)).toBeNull();
    expect(parseRating("5")).toBe(5);
    expect(parseRating("6")).toBeNull();
    expect(parseRating("nota 5")).toBeNull();
  });

  it("textos e configuração", () => {
    expect(buildMenu("Olá", ["Vendas", "Suporte"])).toBe("Olá\n\n*1* - Vendas\n*2* - Suporte");
    expect(renderText("Oi {nome}, ticket {ticket}", { nome: "Ana", ticket: 7 })).toBe("Oi Ana, ticket 7");
    const cfg = parseAutomation({ menu_enabled: "true", inactivity_hours: "12" });
    expect(cfg.menu_enabled).toBe(true);
    expect(cfg.inactivity_hours).toBe(12);
    expect(cfg.rating_enabled).toBe(false);
  });
});
