import { describe, expect, it } from "vitest";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { createActorState } from "../../src/game/state/types";
import { SIMULATION_STEP_SECONDS } from "../../src/game/simulationTiming";
import { LocalRecoilPresentation, LocalShotPredictor } from "../../src/network/LocalShotPredictor";

describe("LocalShotPredictor", () => {
  it("predicts immediate local presentation at the authoritative weapon cadence", () => {
    const actor = createActorState("human-1", "player", { x: 0, y: 1.76, z: 0 });
    const command = { ...createIdleCommand(), fire: true };
    const predictor = new LocalShotPredictor();

    const first = predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 10);

    expect(first).toMatchObject({
      inputSequence: 10,
      weaponId: "rifle",
      fired: { type: "shot-fired", actorId: actor.id, weaponId: "rifle" },
      trace: { type: "shot-traced", actorId: actor.id, hitType: "miss", targetId: null },
    });
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 11)).toBeNull();
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 12)).toBeNull();
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 13)).not.toBeNull();
    expect(predictor.consumeConfirmedShot("rifle", 13, 10)).toBe(true);
    expect(predictor.consumeConfirmedShot("rifle", 13, 13)).toBe(true);
    expect(predictor.consumeConfirmedShot("rifle", 13, 13)).toBe(false);
  });

  it("does not predict shots that the visible actor state cannot fire", () => {
    const actor = createActorState("human-1", "player", { x: 0, y: 1.76, z: 0 });
    const command = { ...createIdleCommand(), fire: true };
    const predictor = new LocalShotPredictor();
    const weapon = actor.inventory.weaponSlots[0];
    if (!weapon) throw new Error("test weapon missing");

    actor.deployment = "parachuting";
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 1)).toBeNull();
    actor.deployment = "grounded";
    weapon.reloadSeconds = 1;
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 2)).toBeNull();
    weapon.reloadSeconds = 0;
    weapon.ammoInMagazine = 0;
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 3)).toBeNull();
    weapon.ammoInMagazine = 1;
    expect(predictor.predict(
      actor,
      { ...command, switchWeapon: 1 },
      SIMULATION_STEP_SECONDS,
      4,
    )).toBeNull();
  });

  it("does not present more shots than the predicted magazine contains", () => {
    const actor = createActorState("human-1", "player", { x: 0, y: 1.76, z: 0 });
    const weapon = actor.inventory.weaponSlots[0];
    if (!weapon) throw new Error("test weapon missing");
    weapon.ammoInMagazine = 1;
    const command = { ...createIdleCommand(), fire: true };
    const predictor = new LocalShotPredictor();

    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 1)).not.toBeNull();
    predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 2);
    predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 3);
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 4)).toBeNull();

    predictor.cancelPredictedShot(1);
    predictor.synchronize(actor, 1);
    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 5)).not.toBeNull();
  });

  it("deduplicates confirmed local presentation while preserving authoritative impacts", () => {
    const actor = createActorState("human-1", "player", { x: 0, y: 1.76, z: 0 });
    const predictor = new LocalShotPredictor();
    const predicted = predictor.predict(
      actor,
      { ...createIdleCommand(), fire: true },
      SIMULATION_STEP_SECONDS,
      1,
    );
    if (!predicted) throw new Error("predicted shot missing");
    const authoritativeTrace = {
      ...predicted.trace,
      hitType: "actor" as const,
      targetId: "target",
    };

    const reconciled = predictor.reconcileAuthoritativeEvents(
      [
        { sequence: 1, shotSequence: 1, event: predicted.fired },
        { sequence: 2, shotSequence: 1, event: authoritativeTrace },
      ],
      actor.id,
      4,
    );

    expect(reconciled.audioEvents).not.toContainEqual(predicted.fired);
    expect(reconciled.effectEvents).not.toContainEqual(authoritativeTrace);
    expect(reconciled.impactOnlyEvents).toEqual([authoritativeTrace]);
    expect(reconciled.unpredictedLocalWeaponIds).toEqual([]);

    const unpredicted = predictor.reconcileAuthoritativeEvents(
      [
        { sequence: 3, shotSequence: 99, event: predicted.fired },
        { sequence: 4, shotSequence: 99, event: authoritativeTrace },
      ],
      actor.id,
      5,
    );
    expect(unpredicted.audioEvents).toContainEqual(predicted.fired);
    expect(unpredicted.effectEvents).toContainEqual(authoritativeTrace);
    expect(unpredicted.unpredictedLocalWeaponIds).toEqual(["rifle"]);
  });

  it("retains a prediction when continuous fire is acknowledged before the server shot", () => {
    const actor = createActorState("human-1", "player", { x: 0, y: 1.76, z: 0 });
    const predictor = new LocalShotPredictor();
    expect(predictor.predict(
      actor,
      { ...createIdleCommand(), fire: true },
      SIMULATION_STEP_SECONDS,
      3,
    )).not.toBeNull();

    predictor.synchronize(actor, 3);
    const fired = {
      type: "shot-fired" as const,
      actorId: actor.id,
      weaponId: "rifle",
      origin: { ...actor.position },
    };
    const reconciled = predictor.reconcileAuthoritativeEvents(
      [{ sequence: 1, shotSequence: 3, event: fired }],
      actor.id,
      6,
    );

    expect(reconciled.audioEvents).toEqual([]);
    expect(reconciled.unpredictedLocalWeaponIds).toEqual([]);
  });

  it("keeps acknowledged unconfirmed shots reserved against the visible magazine", () => {
    const actor = createActorState("human-1", "player", { x: 0, y: 1.76, z: 0 });
    const weapon = actor.inventory.weaponSlots[0];
    if (!weapon) throw new Error("test weapon missing");
    weapon.ammoInMagazine = 1;
    const predictor = new LocalShotPredictor();
    const command = { ...createIdleCommand(), fire: true };

    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 1)).not.toBeNull();
    predictor.synchronize(actor, 1);
    predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 2);
    predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 3);

    expect(predictor.predict(actor, command, SIMULATION_STEP_SECONDS, 4)).toBeNull();
  });

  it("keeps predicted recoil visual-only, bounded, and recoverable", () => {
    const recoil = new LocalRecoilPresentation();

    recoil.add(0.05);
    expect(recoil.pitchOffset).toBeCloseTo(-0.05);
    recoil.add(1);
    expect(recoil.pitchOffset).toBe(-0.16);
    recoil.advance(0.5);
    expect(recoil.pitchOffset).toBeCloseTo(-0.07);
    recoil.reset();
    expect(recoil.pitchOffset).toBe(0);
  });
});
