require('./sourcemap-register.js');/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 7884:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DEFAULT_APPROVE_BODY = void 0;
exports.parseInputs = parseInputs;
exports.DEFAULT_APPROVE_BODY = "Automated approval by pr-seal-action after author and changed-file verification.";
function parseInputs(reader, context) {
    const repositoryValue = optionalInput(reader, "repository") || `${context.repo.owner}/${context.repo.repo}`;
    return {
        repository: parseRepository(repositoryValue),
        pullRequestNumber: parsePositiveInteger(requiredInput(reader, "pull-request-number"), "pull-request-number"),
        expectedAuthor: requiredInput(reader, "expected-author"),
        allowedPaths: parseAllowedPaths(reader.getInput("allowed-paths", { required: true })),
        approveToken: requiredInput(reader, "approve-token"),
        mergeToken: requiredInput(reader, "merge-token"),
        mergeMethod: parseMergeMethod(optionalInput(reader, "merge-method") || "squash"),
        approveBody: optionalInput(reader, "approve-body") || exports.DEFAULT_APPROVE_BODY,
    };
}
function requiredInput(reader, name) {
    const value = reader.getInput(name, { required: true }).trim();
    if (value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}
function optionalInput(reader, name) {
    return reader.getInput(name).trim();
}
function parseRepository(value) {
    const parts = value.split("/");
    if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
        throw new Error("repository must be in owner/name format");
    }
    return { owner: parts[0], repo: parts[1], value };
}
function parsePositiveInteger(value, name) {
    if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(`${name} must be a positive integer`);
    }
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)) {
        throw new Error(`${name} must be a positive safe integer`);
    }
    return numberValue;
}
function parseAllowedPaths(value) {
    const paths = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (paths.length === 0) {
        throw new Error("allowed-paths must include at least one path");
    }
    return paths;
}
function parseMergeMethod(value) {
    const normalized = value.toLowerCase();
    if (normalized === "squash" || normalized === "merge" || normalized === "rebase") {
        return normalized;
    }
    throw new Error("merge-method must be one of squash, merge, or rebase");
}


/***/ }),

/***/ 1180:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.run = run;
const seal_adapter_1 = __nccwpck_require__(8369);
const seal_1 = __nccwpck_require__(12);
const inputs_1 = __nccwpck_require__(7884);
async function run(dependencies) {
    const resolvedDependencies = dependencies ?? (await createDefaultDependencies());
    try {
        const inputs = (0, inputs_1.parseInputs)(resolvedDependencies.core, resolvedDependencies.context);
        resolvedDependencies.core.setSecret(inputs.approveToken);
        resolvedDependencies.core.setSecret(inputs.mergeToken);
        const github = await resolvedDependencies.createGitHubSealAdapter({
            approveToken: inputs.approveToken,
            mergeToken: inputs.mergeToken,
        });
        const result = await resolvedDependencies.sealPullRequest(inputs, github);
        resolvedDependencies.core.setOutput("pull-request-id", result.pullRequestId);
        resolvedDependencies.core.setOutput("head-sha", result.headSha);
        resolvedDependencies.core.setOutput("changed-files", JSON.stringify(result.changedFiles));
        resolvedDependencies.core.setOutput("approved", String(result.approved));
        resolvedDependencies.core.setOutput("auto-merge-enabled", String(result.autoMergeEnabled));
    }
    catch (error) {
        resolvedDependencies.core.setFailed(error instanceof Error ? error.message : String(error));
    }
}
async function createDefaultDependencies() {
    const core = await Promise.all(/* import() */[__nccwpck_require__.e(682), __nccwpck_require__.e(335)]).then(__nccwpck_require__.bind(__nccwpck_require__, 6335));
    const github = await Promise.all(/* import() */[__nccwpck_require__.e(682), __nccwpck_require__.e(358)]).then(__nccwpck_require__.bind(__nccwpck_require__, 7358));
    return {
        core,
        context: github.context,
        createGitHubSealAdapter: seal_adapter_1.createGitHubSealAdapter,
        sealPullRequest: seal_1.sealPullRequest,
    };
}


/***/ }),

/***/ 8369:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.createGitHubSealAdapter = createGitHubSealAdapter;
async function createGitHubSealAdapter(tokens) {
    const github = await Promise.all(/* import() */[__nccwpck_require__.e(682), __nccwpck_require__.e(358)]).then(__nccwpck_require__.bind(__nccwpck_require__, 7358));
    const approveClient = github.getOctokit(tokens.approveToken);
    const mergeClient = github.getOctokit(tokens.mergeToken);
    const approveGraphql = approveClient.graphql;
    const mergeGraphql = mergeClient.graphql;
    return {
        fetchPullRequestSnapshot: (owner, repo, pullNumber) => fetchPullRequestSnapshot(mergeGraphql, owner, repo, pullNumber),
        approvePullRequest: (pullRequestId, headSha, body) => approvePullRequest(approveGraphql, pullRequestId, headSha, body),
        enableAutoMerge: (pullRequestId, headSha, mergeMethod) => enableAutoMerge(mergeGraphql, pullRequestId, headSha, mergeMethod),
    };
}
async function fetchPullRequestSnapshot(graphql, owner, repo, pullNumber) {
    const changedFiles = [];
    let fileCursor = null;
    let firstHeadSha;
    let pullRequest;
    for (;;) {
        const response = (await graphql(`query($owner: String!, $repo: String!, $pullNumber: Int!, $fileCursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            id
            number
            state
            author { login }
            headRefOid
            files(first: 100, after: $fileCursor) {
              nodes { path changeType }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`, { owner, repo, pullNumber, fileCursor }));
        const data = response.repository?.pullRequest;
        if (!data) {
            throw new Error(`Failed to resolve pull request ${owner}/${repo}#${pullNumber}`);
        }
        if (firstHeadSha && data.headRefOid !== firstHeadSha) {
            throw new Error(`Refusing to seal ${owner}/${repo}#${pullNumber} because changed file pagination observed multiple head SHAs: ${firstHeadSha}, ${data.headRefOid}`);
        }
        firstHeadSha = data.headRefOid;
        pullRequest = {
            id: data.id,
            number: data.number,
            state: data.state.toLowerCase(),
            authorLogin: data.author?.login ?? "",
            headSha: data.headRefOid,
        };
        if (!data.files.nodes) {
            throw new Error(`GitHub did not return changed-file nodes for ${owner}/${repo}#${pullNumber}`);
        }
        for (const file of data.files.nodes) {
            if (!file?.path || !file.changeType) {
                throw new Error(`GitHub returned an incomplete changed-file node for ${owner}/${repo}#${pullNumber}`);
            }
            if (file.changeType === "RENAMED") {
                throw new Error(`Refusing to seal ${owner}/${repo}#${pullNumber} because renamed files cannot be safely verified: ${file.path}`);
            }
            changedFiles.push(file.path);
        }
        if (!data.files.pageInfo.hasNextPage) {
            break;
        }
        if (!data.files.pageInfo.endCursor) {
            throw new Error(`GitHub did not return a changed-file pagination cursor for ${owner}/${repo}#${pullNumber}`);
        }
        fileCursor = data.files.pageInfo.endCursor;
    }
    return { pullRequest: pullRequest, changedFiles };
}
async function approvePullRequest(graphql, pullRequestId, headSha, body) {
    const response = (await graphql(`mutation($pullRequestId: ID!, $commitOID: GitObjectID!, $body: String!) {
      addPullRequestReview(input: {
        pullRequestId: $pullRequestId,
        commitOID: $commitOID,
        event: APPROVE,
        body: $body
      }) {
        pullRequestReview { id }
      }
    }`, { pullRequestId, commitOID: headSha, body }));
    const reviewId = response.addPullRequestReview.pullRequestReview?.id;
    if (!reviewId) {
        throw new Error("GitHub did not return an approval review ID");
    }
    return reviewId;
}
async function enableAutoMerge(graphql, pullRequestId, headSha, mergeMethod) {
    const response = (await graphql(`mutation($pullRequestId: ID!, $expectedHeadOid: GitObjectID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: {
        pullRequestId: $pullRequestId,
        expectedHeadOid: $expectedHeadOid,
        mergeMethod: $mergeMethod
      }) {
        pullRequest { id }
      }
    }`, { pullRequestId, expectedHeadOid: headSha, mergeMethod: toGraphqlMergeMethod(mergeMethod) }));
    if (!response.enablePullRequestAutoMerge.pullRequest?.id) {
        throw new Error("GitHub did not return an auto-merge pull request ID");
    }
}
function toGraphqlMergeMethod(mergeMethod) {
    if (mergeMethod === "squash") {
        return "SQUASH";
    }
    if (mergeMethod === "merge") {
        return "MERGE";
    }
    return "REBASE";
}


/***/ }),

/***/ 12:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.sealPullRequest = sealPullRequest;
const verify_1 = __nccwpck_require__(5896);
async function sealPullRequest(inputs, github) {
    const { owner, repo, value } = inputs.repository;
    const snapshot = await github.fetchPullRequestSnapshot(owner, repo, inputs.pullRequestNumber);
    const verified = (0, verify_1.verifyPullRequestSafety)(snapshot.pullRequest, snapshot.changedFiles, {
        repository: value,
        pullRequestNumber: inputs.pullRequestNumber,
        expectedAuthor: inputs.expectedAuthor,
        allowedPaths: inputs.allowedPaths,
    });
    await github.approvePullRequest(verified.pullRequestId, verified.headSha, inputs.approveBody);
    await github.enableAutoMerge(verified.pullRequestId, verified.headSha, inputs.mergeMethod);
    return {
        pullRequestId: verified.pullRequestId,
        headSha: verified.headSha,
        changedFiles: verified.changedFiles,
        approved: true,
        autoMergeEnabled: true,
    };
}


/***/ }),

/***/ 5896:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.verifyPullRequestSafety = verifyPullRequestSafety;
function verifyPullRequestSafety(pullRequest, changedFiles, inputs) {
    const subject = `${inputs.repository}#${inputs.pullRequestNumber}`;
    if (pullRequest.state !== "open") {
        throw new Error(`Refusing to seal ${subject} because the pull request is ${pullRequest.state}`);
    }
    if (pullRequest.number !== inputs.pullRequestNumber) {
        throw new Error(`Fetched pull request number ${pullRequest.number} does not match requested ${subject}`);
    }
    if (pullRequest.authorLogin !== inputs.expectedAuthor) {
        throw new Error(`Refusing to seal ${subject} because the PR author is ${pullRequest.authorLogin}, expected ${inputs.expectedAuthor}`);
    }
    const allowedPathSet = new Set(inputs.allowedPaths);
    const disallowedPaths = changedFiles.filter((file) => !allowedPathSet.has(file));
    if (disallowedPaths.length > 0) {
        throw new Error(`Refusing to seal ${subject} because changed files include disallowed paths: ${disallowedPaths.join(", ")}. Allowed paths: ${inputs.allowedPaths.join(", ")}`);
    }
    if (pullRequest.id.length === 0) {
        throw new Error(`Failed to resolve pull request node ID for ${subject}`);
    }
    if (pullRequest.headSha.length === 0) {
        throw new Error(`Failed to resolve pull request head SHA for ${subject}`);
    }
    return {
        pullRequestId: pullRequest.id,
        headSha: pullRequest.headSha,
        changedFiles,
    };
}


/***/ }),

/***/ 2613:
/***/ ((module) => {

module.exports = require("assert");

/***/ }),

/***/ 5317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 6982:
/***/ ((module) => {

module.exports = require("crypto");

/***/ }),

/***/ 4434:
/***/ ((module) => {

module.exports = require("events");

/***/ }),

/***/ 9896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 8611:
/***/ ((module) => {

module.exports = require("http");

/***/ }),

/***/ 5692:
/***/ ((module) => {

module.exports = require("https");

/***/ }),

/***/ 9278:
/***/ ((module) => {

module.exports = require("net");

/***/ }),

/***/ 4589:
/***/ ((module) => {

module.exports = require("node:assert");

/***/ }),

/***/ 6698:
/***/ ((module) => {

module.exports = require("node:async_hooks");

/***/ }),

/***/ 4573:
/***/ ((module) => {

module.exports = require("node:buffer");

/***/ }),

/***/ 7540:
/***/ ((module) => {

module.exports = require("node:console");

/***/ }),

/***/ 7598:
/***/ ((module) => {

module.exports = require("node:crypto");

/***/ }),

/***/ 3053:
/***/ ((module) => {

module.exports = require("node:diagnostics_channel");

/***/ }),

/***/ 610:
/***/ ((module) => {

module.exports = require("node:dns");

/***/ }),

/***/ 8474:
/***/ ((module) => {

module.exports = require("node:events");

/***/ }),

/***/ 7067:
/***/ ((module) => {

module.exports = require("node:http");

/***/ }),

/***/ 2467:
/***/ ((module) => {

module.exports = require("node:http2");

/***/ }),

/***/ 7030:
/***/ ((module) => {

module.exports = require("node:net");

/***/ }),

/***/ 643:
/***/ ((module) => {

module.exports = require("node:perf_hooks");

/***/ }),

/***/ 1792:
/***/ ((module) => {

module.exports = require("node:querystring");

/***/ }),

/***/ 7075:
/***/ ((module) => {

module.exports = require("node:stream");

/***/ }),

/***/ 1692:
/***/ ((module) => {

module.exports = require("node:tls");

/***/ }),

/***/ 3136:
/***/ ((module) => {

module.exports = require("node:url");

/***/ }),

/***/ 7975:
/***/ ((module) => {

module.exports = require("node:util");

/***/ }),

/***/ 3429:
/***/ ((module) => {

module.exports = require("node:util/types");

/***/ }),

/***/ 5919:
/***/ ((module) => {

module.exports = require("node:worker_threads");

/***/ }),

/***/ 8522:
/***/ ((module) => {

module.exports = require("node:zlib");

/***/ }),

/***/ 857:
/***/ ((module) => {

module.exports = require("os");

/***/ }),

/***/ 6928:
/***/ ((module) => {

module.exports = require("path");

/***/ }),

/***/ 3193:
/***/ ((module) => {

module.exports = require("string_decoder");

/***/ }),

/***/ 3557:
/***/ ((module) => {

module.exports = require("timers");

/***/ }),

/***/ 4756:
/***/ ((module) => {

module.exports = require("tls");

/***/ }),

/***/ 9023:
/***/ ((module) => {

module.exports = require("util");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId].call(module.exports, module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__nccwpck_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/create fake namespace object */
/******/ 	(() => {
/******/ 		var getProto = Object.getPrototypeOf ? (obj) => (Object.getPrototypeOf(obj)) : (obj) => (obj.__proto__);
/******/ 		var leafPrototypes;
/******/ 		// create a fake namespace object
/******/ 		// mode & 1: value is a module id, require it
/******/ 		// mode & 2: merge all properties of value into the ns
/******/ 		// mode & 4: return value when already ns object
/******/ 		// mode & 16: return value when it's Promise-like
/******/ 		// mode & 8|1: behave like require
/******/ 		__nccwpck_require__.t = function(value, mode) {
/******/ 			if(mode & 1) value = this(value);
/******/ 			if(mode & 8) return value;
/******/ 			if(typeof value === 'object' && value) {
/******/ 				if((mode & 4) && value.__esModule) return value;
/******/ 				if((mode & 16) && typeof value.then === 'function') return value;
/******/ 			}
/******/ 			var ns = Object.create(null);
/******/ 			__nccwpck_require__.r(ns);
/******/ 			var def = {};
/******/ 			leafPrototypes = leafPrototypes || [null, getProto({}), getProto([]), getProto(getProto)];
/******/ 			for(var current = mode & 2 && value; typeof current == 'object' && !~leafPrototypes.indexOf(current); current = getProto(current)) {
/******/ 				Object.getOwnPropertyNames(current).forEach((key) => (def[key] = () => (value[key])));
/******/ 			}
/******/ 			def['default'] = () => (value);
/******/ 			__nccwpck_require__.d(ns, def);
/******/ 			return ns;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__nccwpck_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__nccwpck_require__.o(definition, key) && !__nccwpck_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/ensure chunk */
/******/ 	(() => {
/******/ 		__nccwpck_require__.f = {};
/******/ 		// This file contains only the entry chunk.
/******/ 		// The chunk loading function for additional chunks
/******/ 		__nccwpck_require__.e = (chunkId) => {
/******/ 			return Promise.all(Object.keys(__nccwpck_require__.f).reduce((promises, key) => {
/******/ 				__nccwpck_require__.f[key](chunkId, promises);
/******/ 				return promises;
/******/ 			}, []));
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks
/******/ 		__nccwpck_require__.u = (chunkId) => {
/******/ 			// return url for filenames based on template
/******/ 			return "" + chunkId + ".index.js";
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__nccwpck_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__nccwpck_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/******/ 	/* webpack/runtime/require chunk loading */
/******/ 	(() => {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded chunks
/******/ 		// "1" means "loaded", otherwise not loaded yet
/******/ 		var installedChunks = {
/******/ 			792: 1
/******/ 		};
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		var installChunk = (chunk) => {
/******/ 			var moreModules = chunk.modules, chunkIds = chunk.ids, runtime = chunk.runtime;
/******/ 			for(var moduleId in moreModules) {
/******/ 				if(__nccwpck_require__.o(moreModules, moduleId)) {
/******/ 					__nccwpck_require__.m[moduleId] = moreModules[moduleId];
/******/ 				}
/******/ 			}
/******/ 			if(runtime) runtime(__nccwpck_require__);
/******/ 			for(var i = 0; i < chunkIds.length; i++)
/******/ 				installedChunks[chunkIds[i]] = 1;
/******/ 		
/******/ 		};
/******/ 		
/******/ 		// require() chunk loading for javascript
/******/ 		__nccwpck_require__.f.require = (chunkId, promises) => {
/******/ 			// "1" is the signal for "already loaded"
/******/ 			if(!installedChunks[chunkId]) {
/******/ 				if(true) { // all chunks have JS
/******/ 					installChunk(require("./" + __nccwpck_require__.u(chunkId)));
/******/ 				} else installedChunks[chunkId] = 1;
/******/ 			}
/******/ 		};
/******/ 		
/******/ 		// no external install chunk
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it uses a non-standard name for the exports (exports).
(() => {
var exports = __webpack_exports__;

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.run = void 0;
const run_1 = __nccwpck_require__(1180);
Object.defineProperty(exports, "run", ({ enumerable: true, get: function () { return run_1.run; } }));
if (require.main === require.cache[eval('__filename')]) {
    void (0, run_1.run)();
}

})();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=index.js.map