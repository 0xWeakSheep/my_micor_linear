import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("demo@orbit.local");
  await page.getByRole("textbox", { name: "密码", exact: true }).fill("demo12345");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/orbit\/my-issues\/assigned$/);
  await expect(page.getByRole("main")).toBeVisible();
}

test("登录后可以全文搜索并打开 Issue", async ({ page }) => {
  await login(page);
  await page.goto("/orbit/search");
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

test("移动端可以通过抽屉进入 Inbox 并打开详情", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "仅在移动端项目验证响应式导航。");
  await login(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Workspace navigation" }).getByRole("link", { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/orbit\/inbox$/);
  await page.getByRole("option").first().click();
  await expect(page.getByRole("button", { name: "返回 Inbox" })).toBeVisible();
});
