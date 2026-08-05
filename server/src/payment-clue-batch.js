'use strict';

const { parseSpreadsheetUpload } = require('./spreadsheet-import');
const { previewPaymentClueCsv } = require('./payment-clue-import');

const MAX_PAYMENT_BATCH_FILES = 10;
const MAX_PAYMENT_BATCH_BYTES = 30 * 1024 * 1024;
const MAX_PAYMENT_BATCH_ROWS = 30000;
const PAYMENT_SOURCES = new Set(['wechat_shop_order','wechat_merchant_receipt','manual_transfer']);

function encodedUploadBytes(input = {}) {
  if (String(input.format || '').toLowerCase() === 'csv' || typeof input.csv === 'string') {
    return Buffer.byteLength(String(input.csv || ''), 'utf8');
  }
  const encoded = String(input.dataBase64 || '');
  return Math.max(0, Math.floor((encoded.length / 4) * 3) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0));
}

function blankCounts() {
  return { totalRows:0, matchingCandidateRows:0, needsManualRows:0, groupEntryClueRows:0, phoneClueRows:0, nameClueRows:0, priceClueRows:0, priceUnclassifiedRows:0, possibleRefundRows:0, a1CandidateRows:0, a2CandidateRows:0 };
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += Number(source[key] || 0);
}

function safeFileError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'SPREADSHEET_INVALID';
  const message = typeof error?.message === 'string' && error.message.length <= 160 ? error.message : '文件无法安全预检';
  return { code, message };
}

async function previewPaymentClueBatch(input = {}, dependencies = {}) {
  const parseUpload = dependencies.parseSpreadsheetUpload || parseSpreadsheetUpload;
  const source = PAYMENT_SOURCES.has(input.paymentSource) ? input.paymentSource : 'wechat_shop_order';
  const files = Array.isArray(input.files) ? input.files : [];
  if (!files.length) throw Object.assign(new Error('请至少选择一个付款记录文件'), { statusCode:400, code:'PAYMENT_BATCH_EMPTY' });
  if (files.length > MAX_PAYMENT_BATCH_FILES) throw Object.assign(new Error(`单批最多选择 ${MAX_PAYMENT_BATCH_FILES} 个文件`), { statusCode:413, code:'PAYMENT_BATCH_TOO_MANY_FILES' });
  if (source !== 'wechat_merchant_receipt' && files.length > 1) throw Object.assign(new Error('当前仅商户号支付小票支持多文件同批预检'), { statusCode:400, code:'PAYMENT_BATCH_SOURCE_UNSUPPORTED' });
  const totalUploadBytes = files.reduce((sum, file) => sum + encodedUploadBytes(file), 0);
  if (totalUploadBytes > MAX_PAYMENT_BATCH_BYTES) throw Object.assign(new Error('整批文件超过 30MB 安全硬上限，请分成两个批次'), { statusCode:413, code:'PAYMENT_BATCH_TOO_LARGE' });

  const aggregate = blankCounts();
  const recognized = new Set();
  const fileResults = [];
  let ignoredColumnCount = 0;
  let pricingRulesConfigured = false;
  for (let index = 0; index < files.length; index += 1) {
    try {
      const upload = await parseUpload(files[index]);
      const preview = previewPaymentClueCsv(upload.csv, { source, priceRoleRules:input.priceRoleRules });
      addCounts(aggregate, preview.counts);
      preview.recognizedFields.forEach(field => recognized.add(field));
      ignoredColumnCount += preview.ignoredColumnCount;
      pricingRulesConfigured = pricingRulesConfigured || preview.pricingRulesConfigured;
      fileResults.push({
        fileIndex:index + 1,
        status:'ready_for_human_review',
        spreadsheet:{ format:upload.meta.format, rowCount:upload.meta.rowCount, columnCount:upload.meta.columnCount, sheetDetected:Boolean(upload.meta.sheetName), formulaCellsReadAsCachedValues:upload.meta.formulaCellsReadAsCachedValues || 0 },
        summary:preview.counts,
        recognizedFields:preview.recognizedFields,
        ignoredColumnCount:preview.ignoredColumnCount
      });
    } catch (error) {
      fileResults.push({ fileIndex:index + 1, status:'error', error:safeFileError(error) });
    }
  }

  const validFileCount = fileResults.filter(file => file.status === 'ready_for_human_review').length;
  const errorFileCount = fileResults.length - validFileCount;
  const result = {
    kind:'payment_clue_batch_summary', paymentSource:source,
    batchStatus:errorFileCount ? 'partial_review_required' : 'ready_for_human_review',
    selectedFileCount:files.length, validFileCount, errorFileCount,
    totalUploadBytes, totalRows:aggregate.totalRows,
    files:fileResults, summary:aggregate,
    recognizedFields:[...recognized], ignoredColumnCount, pricingRulesConfigured,
    safeguards:{ rawValuesReturned:false, rawHeadersReturned:false, filenamesReturned:false, rowsReturned:false, determinesMembershipAlone:false, publicDirectoryMutationAllowed:false }
  };
  if (aggregate.totalRows > MAX_PAYMENT_BATCH_ROWS) {
    const error = Object.assign(new Error(`整批共 ${aggregate.totalRows} 行，超过 ${MAX_PAYMENT_BATCH_ROWS} 行安全硬上限，请分成两个批次`), { statusCode:413, code:'PAYMENT_BATCH_TOO_MANY_ROWS', safeBatch:result });
    throw error;
  }
  return result;
}

module.exports = { MAX_PAYMENT_BATCH_FILES, MAX_PAYMENT_BATCH_BYTES, MAX_PAYMENT_BATCH_ROWS, previewPaymentClueBatch };
