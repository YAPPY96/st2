
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto("http://localhost:8081", timeout=60000)
            # ページが表示されるまで少し待つ
            page.wait_for_timeout(5000)

            # スクリーンショットを撮る
            page.screenshot(path="verification/app_screenshot.png")
            print("Screenshot taken")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
