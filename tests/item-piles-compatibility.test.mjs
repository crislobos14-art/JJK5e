import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("Item Piles allows normal loot but cancels single, batch and combined actor-bound transfers", () => {
  const source = readFileSync(new URL("../scripts/jjk5e.js", import.meta.url), "utf8");
  const adapter = source.slice(source.indexOf("function actorBoundPileItem"), source.indexOf("function integrationReport"));
  const handlers = new Map();
  let warnings = 0;
  const game = {system:{id:"dnd5e"},modules:new Map([["item-piles",{active:true}]]),i18n:{lang:"es"}};
  runInNewContext(adapter, {
    game, baseName: item => item.name, ui:{notifications:{warn:() => warnings++}},
    Hooks:{once: (_name, fn) => fn(), on: (name, fn) => handlers.set(name,fn)}
  });
  const pool = {_id:"pool", flags:{jjk5e:{cePool:true}}};
  const potion = {_id:"potion"};
  const actor = {uuid:"Actor.one",items:new Map([["pool",pool],["potion",potion]])};
  const target = {uuid:"Actor.two"};
  const delta = item => ({itemDeltas:[{item}]});
  assert.equal(handlers.get("item-piles-preTransferItems")(actor,delta(potion),target),undefined);
  assert.equal(handlers.get("item-piles-preTransferItems")(actor,delta({_id:"pool"}),target),false);
  assert.equal(handlers.get("item-piles-preTransferAllItems")(actor,delta(pool),target),false);
  assert.equal(handlers.get("item-piles-preTransferEverything")([target,actor],[delta(potion),delta(pool)],{uuid:"Actor.three"}),false);
  assert.equal(warnings,3);
});
