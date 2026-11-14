// Constants
const PLUGIN_PATH = LiteLoader.plugins["gpt_reply"].path.plugin;
const ICON_PATH = "res/openai_tooltip.svg";

// Variables
let gptThinking = false;
let messageEl;
let appended = true;

// QQNT 9.9.22+ 换掉了 CKEditor，输入框改成 ProseMirror(.qq-msg-editor)，
// 旧版选择器全部失效，所以这里改成「多选择器 + 兜底」的方式。
const SELECTORS = {
  // 悬浮回复面板的挂载点（需要是定位容器）
  responseAnchor: [".chat-input-area", ".chat-input-area__editor", ".ck-editor"],
  // 输入框（新版 ProseMirror / 旧版 CKEditor）
  editor: [".qq-msg-editor", ".ck.ck-content.ck-editor__editable", ".ck-content"],
  // 输入框工具栏
  funcBar: [
    ".chat-func-bar .func-bar-native:first-child",
    ".chat-func-bar > div:first-child",
    ".chat-func-bar",
  ],
  // 消息列表（用于右键取消息）
  messageList: [".chat-msg-area__vlist", "#ml-root .ml-list", ".ml-list"],
  // 单条消息内容
  messageContent: [".message-content", ".msg-content-container", ".message-native", ".file-message--content"],
};

/**
 * 依次尝试多个选择器，返回第一个命中的元素
 * @param {string[]} selectors
 * @returns {HTMLElement|null}
 */
function pick(selectors) {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) return element;
    } catch (_) {
      // 忽略非法选择器
    }
  }
  return null;
}

/**
 * 读取输入框中的文本
 * @returns {string}
 */
function getEditorText() {
  const editor = pick(SELECTORS.editor);
  return editor?.innerText?.trim() ?? "";
}

/**
 * 设置回复区域的文本
 * @param {string} text
 */
function setResponseText(text) {
  const el = document.getElementById("response-text");
  if (el) el.innerText = text;
}

// Utility Functions
function log(...args) {
  console.log(`[GPT-Reply]`, ...args);
}

/**
 * 获取并设置图标
 * @param {string} iconPath - 图标路径
 * @param {HTMLElement} element - 要设置图标的元素
 * @param {string} [id=null] - 可选，设置到图标的ID
 */
function fetchIcon(iconPath, element, id = null) {
  fetch(`local:///${PLUGIN_PATH}/${iconPath}`)
    .then((response) => response.text())
    .then((data) => {
      element.innerHTML = data;
      if (id) {
        element.querySelector("svg").id = id;
      }
    });
}

/**
 * 观察指定元素并执行回调
 * @param {string} selector - 选择器
 * @param {Function} callback - 元素出现时的回调函数
 * @param {boolean} [continuous=false] - 是否持续观察
 */
function observeElement(selector, callback, continuous = false) {
  let elementExists = false;
  const timer = setInterval(() => {
    const element = document.querySelector(selector);
    if (element && !elementExists) {
      elementExists = true;
      callback();
      if (!continuous) clearInterval(timer);
    } else if (!element) {
      elementExists = false;
    }
  }, 100);
}

/**
 * 获取GPT回复
 * @param {string} prompt - 用户输入的提示
 * @param {Function} callback - 回复结果的回调函数
 */
async function getGPTResponse(prompt, callback) {
  try {
    const settings = await gpt_reply.getSettings();
    const response = await gpt_reply.getGPTReply({
      system_message: settings.system_message,
      prompt: prompt,
      model: settings.model,
    });
    callback({ code: 200, data: response });
  } catch (error) {
    log("[回复错误]", error);
    callback({ code: -1, message: error.message });
  }
}

/**
 * 流式获取GPT回复
 * @param {string} prompt - 用户输入的提示
 * @param {string} streamElementId - 显示流式数据的HTML元素ID
 */
async function streamGPTResponse(prompt, streamElementId, customSystemMessage = null) {
  const settings = await gpt_reply.getSettings();
  const params = {
      system_message: customSystemMessage || settings.system_message,
      prompt: prompt,
      model: settings.model,
      request_id: Date.now().toString(),
  };
  window.gpt_reply.streamGPTReply(params, streamElementId);
}

/**
 * 创建工具栏图标
 * @param {string} iconPath - 图标路径
 * @param {string} innerText - 图标内的文字
 * @param {Function} clickEvent - 点击事件
 * @param {Function} [mouseEnterEvent] - 鼠标进入事件
 * @param {Function} [mouseLeaveEvent] - 鼠标离开事件
 * @returns {HTMLElement} 创建的图标元素
 */
function createBarIcon(
  iconPath,
  innerText,
  clickEvent,
  mouseEnterEvent,
  mouseLeaveEvent
) {
  const qTooltips = document.createElement("div");
  const qTooltipsContent = document.createElement("div");
  const icon = document.createElement("i");
  const barIcon = document.createElement("div");

  barIcon.classList.add("gpt-reply-bar-icon");
  barIcon.appendChild(qTooltips);

  qTooltips.classList.add("gpt-reply-q-tooltips");
  qTooltips.addEventListener("click", clickEvent);
  if (mouseEnterEvent) barIcon.addEventListener("mouseenter", mouseEnterEvent);
  if (mouseLeaveEvent) barIcon.addEventListener("mouseleave", mouseLeaveEvent);

  qTooltips.appendChild(icon);
  qTooltips.appendChild(qTooltipsContent);

  qTooltipsContent.classList.add("gpt-reply-q-tooltips__content");
  qTooltipsContent.innerText = innerText;

  icon.classList.add("gpt-reply-q-icon");
  fetchIcon(iconPath, icon);

  return barIcon;
}

/**
 * 获取消息元素
 * @param {HTMLElement} target - 目标元素
 * @returns {HTMLElement} 消息内容容器元素
 */
function getMessageElement(target) {
  if (!(target instanceof HTMLElement)) return null;
  if (target.matches(".msg-content-container")) return target;
  const container = target.closest(".msg-content-container");
  if (container) return container;
  // 新版布局下部分消息（图片/文件/卡片）没有 .msg-content-container
  return target.closest(".message") || target.closest(".ml-item");
}

/**
 * 从消息元素中取出可读文本
 * @param {HTMLElement} element
 * @returns {string}
 */
function getMessageText(element) {
  if (!element) return "";
  for (const selector of SELECTORS.messageContent) {
    const node = element.querySelector(selector);
    const text = node?.innerText?.trim();
    if (text) return text;
  }
  return element.innerText?.trim() ?? "";
}

/**
 * 处理右键GPT回复菜单
 */
async function handleContextMenu() {
  // 不再依赖 "#ml-root .ml-list"（新版已不存在），直接监听 document，
  // 用 e.target 回溯消息节点，兼容新旧布局。
  if (window.__gpt_reply_context_menu_hooked__) return;
  window.__gpt_reply_context_menu_hooked__ = true;

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 2) {
        appended = true;
        return;
      }
      messageEl = getMessageElement(e.target);
      appended = false;
    },
    true
  );

  new MutationObserver(async () => {
    if (appended) return;
    const qContextMenu = document.querySelector(".q-context-menu");
    if (!qContextMenu) return;

    // 已经插入过就不再重复插入
    if (qContextMenu.querySelector(".gpt-reply-context-item")) {
      appended = true;
      return;
    }

    const firstMenuItem = qContextMenu.querySelector(".q-context-menu-item");
    const separator = qContextMenu.querySelector(".q-context-menu-separator");
    if (!firstMenuItem || !separator) return;

    const messageText = getMessageText(messageEl);
    if (!messageText) return;

    try {
      const settings = (await gpt_reply.getSettings()) || {};
      const presets = Array.isArray(settings.system_message_presets)
        ? settings.system_message_presets
        : [];

      const addMenuItem = (label, systemMessage) => {
        const menuItem = firstMenuItem.cloneNode(true);
        menuItem.classList.add("gpt-reply-context-item");
        const span = menuItem.querySelector("span");
        if (span) span.innerText = label;
        fetchIcon(ICON_PATH, menuItem.querySelector(".q-icon"), "gpt-context-menu-icon");
        menuItem.addEventListener("click", () => {
          qContextMenu.style.display = "none";
          ensureResponseArea();
          setResponseText("GPT思考中...");
          showGPTResponse(messageText, systemMessage);
        });
        qContextMenu.insertBefore(menuItem, separator);
      };

      if (settings.preset_in_context === "on" && presets.length > 0) {
        presets.forEach((preset) => addMenuItem(`GPT (${preset.name})`, preset.message));
      } else {
        const index = Number(settings.selected_preset_index ?? 0);
        addMenuItem("GPT", presets[index]?.message ?? settings.system_message);
      }
      appended = true;
    } catch (error) {
      log("[右键菜单错误]", error);
    }
  }).observe(document.body, { childList: true });
}
/**
 * 注入样式（只注入一次）
 */
function injectStyle() {
  if (document.getElementById("gpt-reply-style")) return;
  const style = document.createElement("link");
  style.id = "gpt-reply-style";
  style.rel = "stylesheet";
  style.href = `local:///${PLUGIN_PATH}/src/style.css`;
  document.head.appendChild(style);
}

/**
 * 确保悬浮回复面板存在（惰性创建，不依赖任何旧版 DOM）
 */
function ensureResponseArea() {
  injectStyle();

  let gptResponse = document.getElementById("gpt-response");
  if (gptResponse) return gptResponse;

  gptResponse = document.createElement("div");
  gptResponse.id = "gpt-response";
  gptResponse.style.zIndex = 999;
  gptResponse.innerHTML = `
        <div class="response-bar">
            <div class="response-title">GPT回复</div>
            <div class="response-buttons">
                <button id="gpt-reply-action-button" class="q-button q-button--small q-button--primary">复制</button>
                <button id="gpt-reply-cancel-button" class="q-button q-button--small q-button--secondary">取消</button>
            </div>
        </div>
        <div id="response-text"></div>
    `;

  // 优先挂到输入区（新旧版本都存在，且是定位容器）；
  // 都没找到时用 fixed 定位兜底，保证功能可用。
  const anchor = pick(SELECTORS.responseAnchor);
  if (anchor) {
    anchor.appendChild(gptResponse);
  } else {
    gptResponse.style.position = "fixed";
    gptResponse.style.bottom = "160px";
    gptResponse.style.left = "50%";
    gptResponse.style.transform = "translateX(-50%)";
    gptResponse.style.width = "min(680px, 80vw)";
    document.body.appendChild(gptResponse);
  }

  gptResponse.querySelector("#gpt-reply-action-button").addEventListener("click", () => {
    const text = document.querySelector("#response-text")?.innerText ?? "";
    navigator.clipboard.writeText(text);
    hideGPTResponse();
  });

  gptResponse.querySelector("#gpt-reply-cancel-button").addEventListener("click", () => {
    hideGPTResponse();
  });

  return gptResponse;
}

/**
 * 聊天框工具栏图标
 */
function ensureBarIcon() {
  const iconBar = pick(SELECTORS.funcBar) || document.querySelector(".chat-func-bar");
  if (!iconBar || iconBar.querySelector(".gpt-reply-bar-icon")) return;

  const baricon = createBarIcon(ICON_PATH, "GPT回复", () => {
    if (gptThinking) return;
    ensureResponseArea();
    const text = getEditorText();
    setResponseText(text ? "GPT思考中..." : "请在聊天框中输入内容");
    showGPTResponse(text);
  });

  iconBar.appendChild(baricon);
}

/**
 * 聊天框GPT回复初始化
 */
let responseAreaInitialized = false;
async function initializeResponseArea() {
  injectStyle();
  ensureBarIcon();
  if (responseAreaInitialized) return;
  responseAreaInitialized = true;
  // 工具栏会被会话切换重建，所以持续检测并补齐图标（只注册一次，避免定时器泄漏）
  observeElement(".chat-func-bar", ensureBarIcon, true);
  // 面板只在需要时创建，避免因编辑器重建导致功能失效
  ensureResponseArea();
}

/**
 * 显示GPT回复
 * @param {string} text - 用户输入的文本
 */
async function showGPTResponse(text, customSystemMessage = null) {
  const settings = (await gpt_reply.getSettings()) || {};

  const gptResponse = ensureResponseArea();
  const actionButton = gptResponse.querySelector("#gpt-reply-action-button");
  if (actionButton) actionButton.innerText = "复制";

  gptResponse.style.display = "block";
  if (typeof gptResponse.animate === "function") {
    gptResponse.animate(
        [
            { opacity: 0, transform: "translateY(20px)" },
            { opacity: 1, transform: "translateY(0px)" },
        ],
        {
            duration: 128,
            easing: "ease-out",
        }
    );
  }

  if (!text) {
      setResponseText("请在聊天框中输入内容");
      return;
  }

  const openaiIsAvaliable = await gpt_reply.checkOpenAI();
  if (!openaiIsAvaliable) {
      setResponseText("未设置 OpenAI API Key");
      return;
  }

  // Use the custom system message if provided
  streamGPTResponse(text, "response-text", customSystemMessage || settings.system_message);
}

/**
 * 隐藏GPT回复
 */
function hideGPTResponse() {
  const gptResponse = document.getElementById("gpt-response");
  if (!gptResponse) return;
  const finish = () => {
    gptResponse.style.display = "none";
    gptThinking = false;
  };
  if (typeof gptResponse.animate === "function") {
    const animation = gptResponse.animate(
      [
        { opacity: 1, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(20px)" },
      ],
      {
        duration: 128,
        easing: "ease-in",
      }
    );
    if (animation) animation.onfinish = finish;
    else finish();
  } else {
    finish();
  }
}

observeElement(".chat-func-bar", () => handleContextMenu());
observeElement(".chat-func-bar", initializeResponseArea, true);

/**
 * 设置窗口创建时的初始化
 * @param {HTMLElement} view - 设置窗口的HTML元素
 */
export const onSettingWindowCreated = async (view) => {
  try {
    const html_file_path = `local:///${PLUGIN_PATH}/src/settings.html`;

    view.innerHTML = await (await fetch(html_file_path)).text();
    const settings = await gpt_reply.getSettings();

    const openai_api_key = view.querySelector("#openai-api-key");
    const openai_base_url = view.querySelector("#openai-base-url");
    const chat_model = view.querySelectorAll('input[name="chat-model"]');
    const custom_chat_model = view.querySelector("#custom-chat-model");
    const system_message = view.querySelector("#system-message");
    const replyModeRadios = view.querySelectorAll('input[name="reply-mode"]');

    // const keep_memory = view.querySelector("#keep-memory");
    // const keep_memory_setting = view.querySelector("#keep-memory-settings");
    // if (settings.keep_memory) {
    //     keep_memory.setAttribute("is-active", "");
    //     keep_memory_setting.style.display = "block";
    // } else {
    //     keep_memory.removeAttribute("is-active");
    //     keep_memory_setting.style.display = "none";
    // }
    // keep_memory.addEventListener("click", (event) => {
    //     const isActive = event.currentTarget.hasAttribute("is-active");
    //     if (isActive) {
    //         event.currentTarget.removeAttribute("is-active");
    //         settings.keep_memory = false;
    //         keep_memory_setting.style.display = "none";
    //     } else {
    //         event.currentTarget.setAttribute("is-active", "");
    //         settings.enableRkeep_memoryemote = true;
    //         keep_memory_setting.style.display = "block";
    //     }
    //     gpt_reply.setSettings(settings);
    // });

    openai_api_key.value = settings.openai_api_key;
    openai_base_url.value = settings.openai_base_url;
    system_message.value = settings.system_message;

    // Initialize preset selector
    const presetSelector = view.querySelector("#preset-selector");
    const savePresetButton = view.querySelector("#save-preset");
    const deletePresetButton = view.querySelector("#delete-preset");

    // Populate presets
    function updatePresetSelector() {
      presetSelector.innerHTML = '<option value="">选择预设...</option>';
      settings.system_message_presets.forEach((preset, index) => {
          const option = document.createElement('option');
          option.value = index.toString();
          option.textContent = preset.name;
          presetSelector.appendChild(option);
      });
      
      if (settings.selected_preset_index !== undefined && settings.selected_preset_index !== null) {
          presetSelector.value = settings.selected_preset_index.toString();
          const selectedPreset = settings.system_message_presets[settings.selected_preset_index];
          if (selectedPreset) {
              system_message.value = selectedPreset.message;
          }
      }
    }
    updatePresetSelector();

    // Handle preset selection
    presetSelector.addEventListener("change", async () => {
      if (presetSelector.value !== "") {
        const selectedIndex = parseInt(presetSelector.value);
        const selectedPreset = settings.system_message_presets[selectedIndex];
        system_message.value = selectedPreset.message;
        settings.system_message = selectedPreset.message;
        settings.selected_preset_index = selectedIndex;  // Save the selected index
        await gpt_reply.setSettings(settings);
      } else {
        settings.selected_preset_index = null;  // Clear selection if "选择预设..." is chosen
        await gpt_reply.setSettings(settings);
      }
    });

    // Save new preset
    savePresetButton.addEventListener("click", async () => {
      try {
        // Create a temporary input dialog
        const dialog = document.createElement("div");
        dialog.style.cssText = `
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: var(--bg_bottom_light);
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              z-index: 10000;
          `;

        dialog.innerHTML = `
              <h3 style="margin: 0 0 15px 0;">输入预设名称</h3>
              <input type="text" id="preset-name-input" value="新预设" style="
                  width: 200px;
                  padding: 5px;
                  margin-bottom: 15px;
                  border: 1px solid var(--border_secondary);
                  border-radius: 4px;
                  background: var(--bg_bottom_light);
                  color: var(--text_primary);
              ">
              <div style="display: flex; gap: 10px; justify-content: flex-end;">
                  <button class="q-button q-button--small q-button--secondary" id="cancel-preset">取消</button>
                  <button class="q-button q-button--small q-button--primary" id="confirm-preset">确定</button>
              </div>
          `;

        document.body.appendChild(dialog);
        const input = dialog.querySelector("#preset-name-input");
        input.select();

        // Handle dialog actions
        return new Promise((resolve) => {
          dialog.querySelector("#cancel-preset").onclick = () => {
            document.body.removeChild(dialog);
            resolve(null);
          };

          dialog.querySelector("#confirm-preset").onclick = () => {
            const presetName = input.value.trim();
            document.body.removeChild(dialog);
            resolve(presetName);
          };

          input.onkeyup = (e) => {
            if (e.key === "Enter") {
              const presetName = input.value.trim();
              document.body.removeChild(dialog);
              resolve(presetName);
            } else if (e.key === "Escape") {
              document.body.removeChild(dialog);
              resolve(null);
            }
          };
        }).then((presetName) => {
          if (presetName) {
            if (!Array.isArray(settings.system_message_presets)) {
              settings.system_message_presets = [];
            }
            settings.system_message_presets.push({
              name: presetName,
              message: system_message.value,
            });
            gpt_reply.setSettings(settings);
            updatePresetSelector();
            presetSelector.value = (
              settings.system_message_presets.length - 1
            ).toString();
          }
        });
      } catch (error) {
        console.error("Error saving preset:", error);
      }
    });

    deletePresetButton.addEventListener("click", async () => {
      if (presetSelector.value !== "") {
        const selectedIndex = parseInt(presetSelector.value);
        const selectedPreset = settings.system_message_presets[selectedIndex];
        if (confirm(`确定要删除预设"${selectedPreset.name}"吗？`)) {
          settings.system_message_presets.splice(selectedIndex, 1);
          
          if (settings.system_message_presets.length > 0) {
            settings.selected_preset_index = 0;
            const firstPreset = settings.system_message_presets[0];
            system_message.value = firstPreset.message;
            settings.system_message = firstPreset.message;
          } else {
            settings.selected_preset_index = null;
          }
          
          await gpt_reply.setSettings(settings);
          updatePresetSelector();

          presetSelector.value = settings.system_message_presets.length > 0 ? "0" : "";
        }
      }
    });

    if (settings.model !== "gpt-4o-mini" && settings.model !== "gpt-4o") {
      custom_chat_model.value = settings.model;
    }

    chat_model.forEach((radio) => {
      if (
        radio.value === settings.model ||
        (radio.value === "custom" &&
          settings.model !== "gpt-4o-mini" &&
          settings.model !== "gpt-4o" &&
          settings.model !== "o1-preview" &&
          settings.model !== "o1-mini" &&
          settings.model !== "gpt-4o-mini-ddg" &&
          settings.model !== "llama-ddg" &&
          settings.model !== "mixtral-ddg" &&
          settings.model !== "claude-3-haiku-ddg")
      ) {
        radio.checked = true;
      } else {
        radio.checked = false;
      }
    });

    chat_model.forEach((radio) => {
      radio.addEventListener("change", async () => {
        if (radio.checked) {
          if (radio.value === "custom") {
            settings.model = custom_chat_model.value;
          } else {
            settings.model = radio.value;
          }
          await gpt_reply.setSettings(settings);
        }
      });
    });

    custom_chat_model.addEventListener("input", async () => {
      const customRadio = view.querySelector(
        'input[name="chat-model"][value="custom"]'
      );
      if (customRadio.checked) {
        settings.model = custom_chat_model.value;
        await gpt_reply.setSettings(settings);
      }
    });
    openai_api_key.addEventListener("input", async () => {
      settings.openai_api_key = openai_api_key.value;
      await gpt_reply.setSettings(settings);
    });

    openai_base_url.addEventListener("input", async () => {
      settings.openai_base_url = openai_base_url.value;
      await gpt_reply.setSettings(settings);
    });

    system_message.addEventListener("input", async () => {
      settings.system_message = system_message.value;
      await gpt_reply.setSettings(settings);
    });

    const githubLink = view.querySelector("#settings-github-link");
    githubLink.addEventListener("click", () => {
      gpt_reply.openWeb(
        "https://github.com/wangyz1999/LiteLoaderQQNT-GPT-Reply"
      );
    });

    const presetInContextRadios = view.querySelectorAll('input[name="preset-in-context"]');
    presetInContextRadios.forEach((radio) => {
        if (radio.value === settings.preset_in_context) {
            radio.checked = true;
        }
        radio.addEventListener("change", async () => {
            if (radio.checked) {
                settings.preset_in_context = radio.value;
                await gpt_reply.setSettings(settings);
            }
        });
    });
  } catch (error) {
    console.error("[设置页面错误]", error);
  }
};
