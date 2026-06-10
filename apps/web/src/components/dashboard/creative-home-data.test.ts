import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creativeEntryCards, inspirationItems } from "./creative-home-data";

describe("creative home static data", () => {
  it("keeps the main creative entries in the required order", () => {
    assert.deepEqual(
      creativeEntryCards.map((card) => card.title),
      ["AI 生图", "AI 视频", "灵动画布"],
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

  it("configures canvas as a home entry", () => {
    const canvasCard = creativeEntryCards.find((card) => card.title === "灵动画布");

    assert.ok(canvasCard);
    assert.deepEqual(canvasCard.actions, [
      { label: "进入画布", href: "/canvas" },
    ]);
  });

  it("provides fourteen discovery inspiration images in order", () => {
    assert.equal(inspirationItems.length, 14);

    for (const [index, item] of inspirationItems.entries()) {
      assert.equal(item.category, "发现");
      assert.equal(Object.hasOwn(item, "href"), false);
      assert.equal(
        item.imageUrl,
        `https://toby-ai-dev.tos-cn-shanghai.volces.com/demos/images/${index + 1}.jpg`,
      );
    }
  });

  it("does not expose removed copy", () => {
    const serializedData = JSON.stringify({ creativeEntryCards, inspirationItems });
    const removedCopy = ["AI " + "片场", "工作" + "流"];

    for (const copy of removedCopy) {
      assert.equal(serializedData.includes(copy), false);
    }
  });

  it("uses theme accents for primary entry cards", () => {
    for (const card of creativeEntryCards) {
      assert.equal(card.accent.includes("primary") || card.accent.includes("secondary"), true);
    }
  });
});
