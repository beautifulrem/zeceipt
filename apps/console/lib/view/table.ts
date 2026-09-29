// The console's tables (slice M1): GOV.UK Frontend's table spacing (components/table/_mixin.scss; R93). Every header
// and cell has 10 px vertical and 20 px right padding, and the last column none on the right, so columns never run
// together and right-aligned amounts meet the table's edge. One class for every table, so the rule cannot drift; `data-table` (globals.css) adds the chrome (slice F4).
export const TABLE_CLASS =
  "data-table w-full text-left text-sm [&_th]:py-2.5 [&_td]:py-2.5 [&_th]:pr-5 [&_td]:pr-5 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0";
