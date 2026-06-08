import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creativeEntryCards, inspirationItems } from "./creative-home-data";

describe("creative home static data", () => {
  it("keeps the main creative entries in the required order", () => {
    assert.deepEqual(
      creativeEntryCards.map((card) => card.title),
      ["AI 生图", "AI 视频"],
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

  it("does not expose canvas as a home entry", () => {
    assert.equal(
      creativeEntryCards.some((card) => card.title === "灵动画布"),
      false,
    );
  });

  it("provides static inspiration items without links or images", () => {
    assert.ok(inspirationItems.length >= 8);

    for (const item of inspirationItems) {
      assert.equal(Object.hasOwn(item, "href"), false);
      assert.equal(Object.hasOwn(item, "image"), false);
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
