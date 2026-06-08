import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creativeEntryCards, inspirationItems } from "./creative-home-data";

describe("creative home static data", () => {
  it("keeps the main creative entries in the required order", () => {
    assert.deepEqual(
      creativeEntryCards.map((card) => card.title),
      ["AI 生图", "AI 视频", "Toby Studio", "灵动画布"],
    );
  });

  it("configures AI video entry actions", () => {
    const videoCard = creativeEntryCards.find((card) => card.title === "AI 视频");

    assert.ok(videoCard);
    assert.deepEqual(videoCard.actions, [
      { label: "快速生成", href: "/generation?mode=video" },
      { label: "视频工坊", href: "/video-studio" },
    ]);
  });

  it("configures Toby Studio and canvas destinations", () => {
    assert.equal(
      creativeEntryCards.find((card) => card.title === "Toby Studio")?.actions[0]?.href,
      "/toby-studio",
    );
    assert.equal(
      creativeEntryCards.find((card) => card.title === "灵动画布")?.actions[0]?.href,
      "/canvas",
    );
  });

  it("provides static inspiration items without links", () => {
    assert.ok(inspirationItems.length >= 8);

    for (const item of inspirationItems) {
      assert.equal(Object.hasOwn(item, "href"), false);
    }
  });

  it("does not expose removed copy", () => {
    const serializedData = JSON.stringify({ creativeEntryCards, inspirationItems });
    const removedCopy = ["AI " + "片场", "工作" + "流"];

    for (const copy of removedCopy) {
      assert.equal(serializedData.includes(copy), false);
    }
  });
});
