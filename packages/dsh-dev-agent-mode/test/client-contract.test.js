import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("client module declares the slots injection it consumes", () => {
  let definition;
  const source = fs.readFileSync(new URL("../src/client.js", import.meta.url), "utf8");

  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value;
        }
      }
    }
  });

  const plugin = definition.factory((id) => {
    assert.equal(id, "react");
    return {};
  });

  assert.equal(plugin.name, "dev-agent-mode");
  assert.deepEqual(Array.from(plugin.inject), ["slots", "workspaces"]);
  assert.equal(typeof plugin.apply, "function");
});
