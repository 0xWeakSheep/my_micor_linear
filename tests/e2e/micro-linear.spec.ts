import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("Micro Linear", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Micro Linear/);
  await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("demo@micro-linear.local");
  await page.getByRole("textbox", { name: "密码", exact: true }).fill("demo12345");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/micro-linear\/my-issues\/assigned$/);
  await expect(page.getByRole("main")).toBeVisible();
}

test("登录后可以全文搜索并打开 Issue", async ({ page }) => {
  await login(page);
  await page.goto("/micro-linear/search");
  const search = page.getByRole("combobox", { name: "全局搜索" });
  await search.fill("ENG-103");
  const result = page.getByRole("option", { name: /ENG-103 Add keyboard navigation/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByRole("dialog", { name: /ENG-103/ })).toBeVisible();
});

test("创建 Issue、评论并移入回收站", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "桌面详情侧栏覆盖删除流程；移动端导航另行验证。");
  await login(page);

  const title = `E2E verification ${Date.now()}`;
  await page.getByRole("banner").getByRole("button", { name: "Create issue" }).click();
  await page.getByPlaceholder("Issue 标题").fill(title);
  await page.getByPlaceholder("添加描述… 支持 Markdown").fill("Created by the Playwright acceptance flow.");
  await page.getByRole("button", { name: "创建 Issue" }).click();

  const dialog = page.getByRole("dialog", { name: new RegExp(title) });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("留下评论… 使用 @邮箱 提及成员").fill("Comment flow verified.");
  await dialog.getByRole("button", { name: "发送" }).click();
  await expect(dialog.getByText("Comment flow verified.")).toBeVisible();

  await dialog.getByRole("button", { name: "移到回收站" }).click();
  await expect(dialog).toBeHidden();
});

test("拖动 Issue 改变状态并在刷新后保持", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "触屏拖拽由组件级交互测试覆盖；此处验证桌面真实指针链路。");
  await login(page);

  const title = `Drag status verification ${Date.now()}`;
  const createResponse = await page.request.post("/api/actions", {
    data: {
      action: "issue.create",
      workspaceId: "ws_micro_linear",
      payload: {
        teamId: "team_design",
        statusId: "state_des_todo",
        title,
      },
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json() as {
    ok: boolean;
    data?: { id: string; identifier: string };
  };
  expect(created.ok).toBe(true);
  expect(created.data).toBeDefined();
  const issueId = created.data!.id;
  const identifier = created.data!.identifier;

  try {
    await page.goto("/micro-linear/team/team_design/issues");
    await page.getByRole("button", { name: "看板" }).click();

    const handle = page.getByRole("button", { name: `拖动 ${identifier}` });
    const sourceCard = page.locator(`[data-issue-card="${identifier}"]`);
    const targetColumn = page.getByRole("region", { name: "状态列 In Progress" });
    await expect(handle).toBeVisible();
    await targetColumn.scrollIntoViewIfNeeded();
    const handleBox = await handle.boundingBox();
    const targetBox = await targetColumn.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/actions") &&
        response.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 10, handleBox!.y + handleBox!.height / 2, { steps: 2 });
    await expect(sourceCard).toHaveClass(/opacity-20/);
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + Math.min(120, targetBox!.height / 2),
      { steps: 12 },
    );
    await page.mouse.up({ button: "left" });
    await page.evaluate(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, buttons: 0 }));
    });
    await expect(sourceCard).not.toHaveClass(/opacity-20/);
    expect((await updateResponse).ok()).toBeTruthy();

    await expect(targetColumn.locator(`[data-issue-card="${identifier}"]`)).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "状态列 In Progress" }).locator(
        `[data-issue-card="${identifier}"]`,
      ),
    ).toBeVisible();
  } finally {
    await page.request.post("/api/actions", {
      timeout: 5_000,
      data: {
        action: "issue.delete",
        workspaceId: "ws_micro_linear",
        payload: { issueId },
      },
    });
  }
});

test("移动端可以通过抽屉进入 Inbox 并打开详情", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "仅在移动端项目验证响应式导航。");
  await login(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Workspace navigation" }).getByRole("link", { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/micro-linear\/inbox$/);
  await page.getByRole("option").first().click();
  await expect(page.getByRole("button", { name: "返回 Inbox" })).toBeVisible();
});
