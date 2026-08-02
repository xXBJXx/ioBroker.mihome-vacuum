'use strict';

function parseCleaningSummary(response) {
    const result = response.result;

    if (result.clean_time) {
        return {
            clean_time: result.clean_time,
            total_area: result.clean_area,
            num_cleanups: result.clean_count,
            cleaning_record_ids: result.records,
        };
    }
    return {
        clean_time: result[0],
        total_area: result[1],
        num_cleanups: result[2],
        cleaning_record_ids: result[3],
    };
}

function isEquivalent(first, second) {
    const firstProperties = Object.getOwnPropertyNames(first);
    const secondProperties = Object.getOwnPropertyNames(second);

    if (firstProperties.length !== secondProperties.length) {
        return false;
    }

    return firstProperties.every(propertyName => first[propertyName] === second[propertyName]);
}

function parseCleaningRecords(response) {
    return response && response.result
        ? response.result.map(entry => {
              if (entry.begin) {
                  return {
                      start_time: entry.begin,
                      end_time: entry.end,
                      duration: entry.duration,
                      area: entry.area,
                      errors: entry.error,
                      completed: entry.complete === 1,
                      start_type: entry.start_type,
                      clean_type: entry.clean_type,
                  };
              }
              return {
                  start_time: entry[0],
                  end_time: entry[1],
                  duration: entry[2],
                  area: entry[3],
                  errors: entry[4],
                  completed: entry[5] === 1,
                  start_type: entry[6],
                  clean_type: entry[7],
              };
          })
        : null;
}

function createHtmlTable(cleaningRecords) {
    const tableAttributes =
        '<colgroup> <col width="50"> <col width="50"> <col width="80"> <col width="100"> <col width="50"> <col width="50"> </colgroup>';
    const tableHeader =
        '<tr> <th>Datum</th> <th>Start</th> <th>Saugzeit</th> <th>Fläche</th> <th>???</th> <th>Ende</th></tr>';

    const lines = cleaningRecords
        .map(
            line =>
                `<tr><td>${line.Datum}</td><td>${line.Start}</td><td ALIGN="RIGHT">${line.Saugzeit}</td><td ALIGN="RIGHT">${line['Fläche']}</td><td ALIGN="CENTER">${line.Error}</td><td ALIGN="CENTER">${line.Ende}</td></tr>`,
        )
        .join('');

    return `<table>${tableAttributes}${tableHeader}${lines}</table>`;
}

module.exports = {
    createHtmlTable,
    isEquivalent,
    parseCleaningRecords,
    parseCleaningSummary,
};
