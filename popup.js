document.addEventListener('DOMContentLoaded', function () {
  const startButton = document.getElementById('start');
  const cancelButton = document.getElementById('cancel');
  const promptsTextarea = document.getElementById('prompts');
  const statusElement = document.getElementById('status');

  // Function to load saved prompts from localStorage
  function loadPrompts() {
    const savedPrompts = localStorage.getItem('prompts');
    if (savedPrompts) {
      promptsTextarea.value = savedPrompts;
    }
  }

  // Save prompts to localStorage whenever they change
  promptsTextarea.addEventListener('input', function () {
    localStorage.setItem('prompts', promptsTextarea.value);
  });

  // Load prompts when the popup is opened
  loadPrompts()

  //reset local storage on initial load
  chrome.storage.local.set({ currentPrompts:[] });

  chrome.storage.local.set({ isScriptRunning: false });

  // Function to start the prompt injection process
  async function startPrompts() {
    // Try parsing the input as a JSON array
    let newPrompts;
    try {
      newPrompts = JSON.parse(promptsTextarea.value);
      if (!Array.isArray(newPrompts)) {
        throw new Error("Input is not a valid JSON array.");
      }
    } catch (e) {
      statusElement.innerText = 'Error: ' + e.message;
      return;
    }

    // Concatenate new prompts to the existing ones in storage
    let { currentPrompts = [] } = await chrome.storage.local.get('currentPrompts')
    console.log("startPrompts: ", currentPrompts)
    currentPrompts = currentPrompts.concat(newPrompts);

    // Store the updated prompts in chrome.storage.local to be accessed by the content script
    await chrome.storage.local.set({ currentPrompts });
    console.log("startPrompts concatenated: ", currentPrompts)


    // Get the active tab using the activeTab permission
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs.length > 0) {
        try {
          // Inject and run the content script that handles the prompts using the active tab's ID
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: runPromptsScript, // Function to run in content script context
          });

          statusElement.innerText = 'All prompts have been successfully submitted!';
        } catch (error) {
          statusElement.innerText = 'Error: ' + error.message;
        }
      } else {
        statusElement.innerText = 'No valid tab found.';
      }
    });
  }

  // Function to be executed in the content script
  async function runPromptsScript() {
    // Check if the script is already running
    const { isScriptRunning } = await chrome.storage.local.get('isScriptRunning');

    if (isScriptRunning) {
      console.log('Script is already running. Prompts concatenated.');
      return;
    }

    // Set the flag to indicate the script is running
    await chrome.storage.local.set({ isScriptRunning: true });

    chrome.storage.local.get('currentPrompts', async ({ currentPrompts }) => {
      console.log("runPromptsScript:", currentPrompts)
      async function injectPromptsSequentially() {
        while (currentPrompts.length > 0) {
          // Get the most current version of the prompts array
          const { currentPrompts: updatedPrompts } = await chrome.storage.local.get('currentPrompts');
          console.log("loop on updatedPrompts:", currentPrompts)
          if (updatedPrompts.length === 0) {
            console.log('Prompt submission cancelled.');
            break; // Stop the loop if the prompts array is emptied
          }

          const prompt = updatedPrompts.shift(); // Get the first prompt and remove it from array
          // Update chrome.storage.local with the remaining prompts
          await chrome.storage.local.set({ currentPrompts: updatedPrompts });
          console.log("shifted updatedPrompts:", updatedPrompts)
          console.log('Inserting prompt:', prompt);
          const editableDiv = document.querySelector('div[contenteditable="true"]');

          if (editableDiv) {
            editableDiv.innerHTML = '';
            editableDiv.focus();
            editableDiv.innerText = prompt; // Set the text directly

            const sendButton = await waitForSendButtonStateChange(true);
            sendButton.click();
            await waitForStopButtonStateChange(true);
            await waitForStopButtonStateChange(false);
            console.log("passed")
          } else {
            console.log('Editable input field not found.');
            break;
          }
        }
        await chrome.storage.local.set({ isScriptRunning: false });
        console.log('All prompts have been submitted.');
      }

      async function waitForSendButtonStateChange(enabled=true) {
        console.log("waiting for sendButton enabled state to be: ", enabled)
        while (true) {
          const sendButton = document.querySelector('button[data-testid="send-button"]');
          if(enabled){
            if (sendButton && sendButton.disabled === false)
              return sendButton

          } else if(!sendButton || sendButton.disabled === true){
            return sendButton
          }
          await delay(500);
        }
      }

      async function waitForStopButtonStateChange(enabled=true) {
        console.log("waiting for stopButton enabled state to be: ", enabled)
        while (true) {
          const stopButton = document.querySelector('button[data-testid="stop-button"]')
          if(enabled){
            if(stopButton && stopButton.disabled === false){
              return stopButton
            }
          }
          else if(!stopButton || stopButton.disabled === true){
            return stopButton
          }
          await delay(500);
        }
      }

      async function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      }

      await injectPromptsSequentially();
    });
  }

  // Start button functionality
  if (startButton && promptsTextarea && statusElement) {
    startButton.addEventListener('click', function () {
      startPrompts();
    });

    // Cancel button functionality
    cancelButton.addEventListener('click', async function () {
      // Clear the remaining prompts by setting the array to an empty array in chrome.storage
      await chrome.storage.local.set({ currentPrompts: [] });
      statusElement.innerText = 'Prompt submission cancelled.';
    });
  }
});
