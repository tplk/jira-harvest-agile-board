/**
 * MIT License
 *
 * Copyright (c) 2018 Dmitry Teplov <siht.pilf@gmail.com> (https://github.com/tplk)

 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// ==UserScript==
// @id              jira-harvest-agile-board
// @name            jira-harvest-agile-board
// @description     Adds button in top right corner of Jira Agile board to start tracking time in HarvestApp.
// @version         1.0
//
// @author          Dmitry Teplov <siht.pilf@gmail.com>
// @namespace       https://github.com/tplk
// @homepageURL     https://github.com/tplk/jira-harvest-agile-board
// @downloadURL     https://github.com/tplk/jira-harvest-agile-board/raw/master/jira-harvest-agile-board.user.js
//
// @license         MIT - https://opensource.org/licenses/MIT
// @copyright       Copyright (c) 2018 Dmitry Teplov <siht.pilf@gmail.com> (https://github.com/tplk)
//
// @include         https://*.atlassian.net/secure/RapidBoard*
// @run-at          document-end
// @noframes
// ==/UserScript==

(function(window) {
  'use strict';
  let w;
  if (typeof unsafeWindow !== 'undefined') {
    w = unsafeWindow;
  } else {
    w = window;
  }

  // Don't run in iframes.
  if (w.self !== w.top) {
    return;
  }

  // Only init on Agile Board.
  if (w.location.pathname.indexOf('RapidBoard') < 0) {
    return;
  }

  const localSettings = [
    'harvestAccountId',
    'harvestApiToken',
  ];

  const localStorageConfig = {};

  // TODO[Dmitry Teplov] switch to GM API.
  localSettings.forEach(name => {
    let value = localStorage.getItem(name);
    if (value == null) {
      value = getSetting(name);
      localStorage.setItem(name, value);
    }
    localStorageConfig[name] = value;
  });

  function getSetting(settingName) {
    const value = w.prompt(`Please set ${settingName}`);
    if (value == null) {
      return getSetting(settingName);
    } else {
      return value;
    }
  }

  const jiraSubdomain = w.location.host.split('.')[0];

  const config = {
    harvestAuthOptions: {
      accountId: localStorageConfig.harvestAccountId,
      apiToken: localStorageConfig.harvestApiToken,
    },
    harvestApi: 'https://api.harvestapp.com/v2/',
    jiraApi: `https://${jiraSubdomain}.atlassian.net/rest/api/2/`,
    permalinkBaseUrl: `https://${jiraSubdomain}.atlassian.net/browse/`,
    externalReferenceService: `${jiraSubdomain}.atlassian.net`,
    trackNeedsDetails: true, // Only start tracking when Issue Details are visible.
    fadeOutDuration: 2000, // Success/error message display duration in ms.
  };

  class BaseAPI {
    constructor() {
      this.harvestApi = config.harvestApi;
      this.jiraApi = config.jiraApi;

      this.harvestAuthHeaders = {
        'Authorization': `Bearer ${config.harvestAuthOptions.apiToken}`,
        'Harvest-Account-Id': config.harvestAuthOptions.accountId,
      };
    }

    // TODO[Dmitry Teplov] switch to GM API.
    async fetch(request) {
      const response = await fetch(request);
      return await response.json();
    }

    jiraRequest(route, options = {}) {
      if (route == null || route.length < 1) {
        throw new Error(`No route was provided.`);
      }

      if (options.headers == null) {
        options.headers = {};
      }

      return new Request(
        this.jiraApi + route,
        {
          ...options,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        },
      );
    }

    harvestRequest(route, options = {}) {
      if (route == null || route.length < 1) {
        throw new Error(`No route was provided.`);
      }

      if (options.headers == null) {
        options.headers = {};
      }

      return new Request(
        this.harvestApi + route,
        {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
            ...this.harvestAuthHeaders,
          },
        },
      );
    }
  }

  class API extends BaseAPI {
    async getLastTimeEntry() {
      const response = await this.fetch(this.harvestRequest(
        `time_entries?per_page=1`,
      ));
      return response.time_entries[0];
    }

    async createTimeEntry(timeEntry) {
      return new Promise((resolve) => {
        this.fetch(this.harvestRequest(
          `time_entries`,
          {
            method: 'POST',
            body: JSON.stringify(timeEntry),
          },
        )).then(() => resolve(true))
          .catch((err) => {
            console.error(err);
            resolve(false);
          });
      });
    }

    async getIssue(issueId) {
      return this.fetch(this.jiraRequest(`issue/${issueId}?fields=summary,project`));
    }
  }

  class HarvestWidgetRenderer {
    constructor(eventCallback) {
      this.fadeOutDuration = config.fadeOutDuration;
      this.eventCallback = eventCallback;
      this.widgetId = 'jira-harvest-agile-board-widget';
      this.widgetContainerSelector = '#gh';
      this.widgetEl = undefined;
      this.controlEl = undefined;

      this.generateCss();
      setTimeout(() => this.render());
    }

    render() {
      // Create widgetEl only if it doesn't exist already.
      if (document.getElementById(this.widgetId) != null) {
        return;
      }

      this.widgetEl = document.createElement('div');
      this.widgetEl.id = this.widgetId;

      this.controlEl = document.createElement('a');

      this.controlEl.innerText = 'Track Selected Issue in Harvest';
      this.controlEl.addEventListener('click', this.eventCallback);

      this.widgetEl.appendChild(this.controlEl);

      document.querySelector(this.widgetContainerSelector).appendChild(this.widgetEl);
    }

    generateCss() {
      const css = `
        #${this.widgetId} {
          right: 0;
          position: absolute;
          top: 10px;
        }

        #${this.widgetId} > .loading {
          color: #ccc;
        }

        #${this.widgetId} > .loading:before,
        #${this.widgetId} > .success:before,
        #${this.widgetId} > .error:before {
          left: -20px;
          position: absolute;
        }

        #${this.widgetId} > .success:before {
          content: '👍';
          animation: fadeOut ${this.fadeOutDuration}ms cubic-bezier(0.55, 0.06, 0.68, 0.19);
        }

        #${this.widgetId} > .error:before {
          content: '🤷️';
          animation: fadeOut ${this.fadeOutDuration}ms cubic-bezier(0.55, 0.06, 0.68, 0.19);
        }

        #${this.widgetId} > .loading:before {
          content: '🌀';
          animation: rotation 2s linear infinite;
        }

        @keyframes fadeOut {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes rotation {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(359deg);
          }
        }
      `;

      const styleEl = document.createElement('style');
      styleEl.type = 'text/css';
      styleEl.appendChild(document.createTextNode(css));

      document.getElementsByTagName('head')[0].appendChild(styleEl);
    }

    startLoading() {
      this.controlEl.classList.add('loading');
    }

    finishLoading() {
      this.controlEl.classList.remove('loading');
    }

    renderSuccessMessage() {
      this.renderResultMessage('success');
    }

    renderErrorMessage() {
      this.renderResultMessage('error');
    }

    renderResultMessage(className) {
      this.controlEl.classList.add(className);
      setTimeout(() => this.controlEl.classList.remove(className), this.fadeOutDuration - 100);
    }
  }

  class HarvestWidget {
    constructor() {
      this.permalinkBaseUrl = config.permalinkBaseUrl;
      this.trackNeedsDetails = config.trackNeedsDetails;
      this.externalReferenceService = config.externalReferenceService;
      this.api = new API();
      const eventCallback = (event) => {
        event.preventDefault();
        this.startTracking();
      };
      this.renderer = new HarvestWidgetRenderer(eventCallback);
      this._isLoading = false;
    }

    get isLoading() {
      return this._isLoading;
    }

    set isLoading(value) {
      if (value === true) {
        this.renderer.startLoading();
        this._isLoading = true;
      } else {
        this.renderer.finishLoading();
        this._isLoading = false;
      }
    }

    getSelectedIssue() {
      const matchResult = w.location.search.match(/selectedIssue=([\w-]+)/);
      if (matchResult != null && matchResult[1] != null) {
        return matchResult[1];
      }
      return null;
    }

    isDetailsViewVisible() {
      const detailsViewEl = document.getElementById('ghx-detail-view');
      return detailsViewEl != null && detailsViewEl.style.display !== 'none';
    }

    // ISO8601 in local time zone
    localISOString() {
      let d = new Date()
        , pad = function(n) {return n < 10 ? '0' + n : n;}
        , tz = d.getTimezoneOffset() // mins
        , tzs = (tz > 0 ? '-' : '+') + pad(parseInt(Math.abs(tz / 60)));

      if (tz % 60 !== 0) {
        tzs += pad(Math.abs(tz % 60));
      }

      if (tz === 0) // Zulu time == UTC
      {
        tzs = 'Z';
      }

      return d.getFullYear() + '-'
        + pad(d.getMonth() + 1) + '-'
        + pad(d.getDate()) + 'T'
        + pad(d.getHours()) + ':'
        + pad(d.getMinutes()) + ':'
        + pad(d.getSeconds()) + tzs;
    };

    async startTracking() {
      if (this.isLoading) {
        return;
      }


      if (this.trackNeedsDetails && this.isDetailsViewVisible() === false) {
        return;
      }

      const issueKey = this.getSelectedIssue();
      if (issueKey == null) {
        return;
      }

      this.isLoading = true;

      const lastTimeEntry = await this.api.getLastTimeEntry();
      const issue = await this.api.getIssue(issueKey);

      const newTimeEntry = {
        project_id: lastTimeEntry.project.id,
        task_id: lastTimeEntry.task.id,
        spent_date: this.localISOString(),
        notes: `${issueKey}: ${issue.fields.summary}`,
        external_reference: {
          id: issue.id,
          group_id: issue.fields.project.id,
          service: this.externalReferenceService,
          permalink: `${this.permalinkBaseUrl}${issueKey}`,
        },
      };

      const result = await this.api.createTimeEntry(newTimeEntry);

      this.isLoading = false;
      if (result === true) {
        this.renderer.renderSuccessMessage();
      } else {
        this.renderer.renderErrorMessage();
      }
    }
  }

  async function start() {
    const widget = new HarvestWidget();
  }

  start();
})(window);
