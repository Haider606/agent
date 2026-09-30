const { getPrinters } = require("pdf-to-printer");

async function listPrinters(){
    const printers = await getPrinters();
    return printers;
}

module.exports = {
    listPrinters
};