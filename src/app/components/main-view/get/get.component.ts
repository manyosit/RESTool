import { Component, Input, Inject, Output, EventEmitter } from '@angular/core';
import { FormGroup, FormControl, FormBuilder } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { RequestHeaders } from '../../../services/config.model';
import { environment } from '../../../../environments/environment';
import { orderBy } from 'natural-orderby';
import { RowFilterPipe } from '../row-filter.pipe';
import { Subscription } from 'rxjs';
import 'rxjs/add/operator/debounceTime';

@Component({
  selector: 'app-get',
  templateUrl: './get.component.html',
  styleUrls: ['./get.component.scss']
})
export class GetComponent {

  @Input('pageData') pageData;

  @Output() stateChanged = new EventEmitter();

  loading: boolean = false;

  data: Array<Object> = [];

  filteredData: Array<Object> = [];

  queryForm: FormGroup = this._fb.group(this.getQueryParamsObj());

  activeGetRequest: any = {};

  fields: any = [];

  filterableFields: any = [];

  queryParams: any = [];

  filterText: string = '';

  filterTextFormControl = new FormControl();

  filterTextFormControlSubscription: Subscription;

  constructor(@Inject('RequestsService') private requestsService,
              @Inject('DataPathUtils') private dataPathUtils,
              @Inject('UrlUtils') private urlUtils,
              private router: Router,
              private route: ActivatedRoute,
              private rowFilterPipe: RowFilterPipe,
              private _fb: FormBuilder,
              private toastrService: ToastrService) {
  }

  ngOnInit() {
    this.subscribeToFilterTextFormControl();
    this.subscribeToFilterQueryParam();
  }

  subscribeToFilterTextFormControl() {
    const filterTextDebounceMilliseconds = 350;
    this.filterTextFormControlSubscription = this.filterTextFormControl.valueChanges
      .debounceTime(filterTextDebounceMilliseconds)
      .subscribe(newValue => this.onFilterTextChange(newValue));
  }

  subscribeToFilterQueryParam() {
    this.route.queryParamMap
      .subscribe(queryParamMap => {
        const filterParam = queryParamMap.get('filter') || '';
        if (filterParam !== this.filterText) {
          this.onFilterTextChange(filterParam, false);
        }
      });
  }

  ngOnChanges() {
    this.firstRequest();
  }

  onClickNew() {
    this.stateChanged.emit({
      state: 'post'
    });
  }

  onClickEdit(row) {
    this.stateChanged.emit({
      state: 'put',
      data: row
    });
  }

  onClickCustomActions(row) {
    this.stateChanged.emit({
      state: 'customActions',
      data: row
    });
  }

  onFilterTextChange(newValue: string, updateQueryParam: boolean = true) {
    this.filterText = newValue;
    this.filterRows();
    if (updateQueryParam) {
      this.updateFilterQueryParam();
    }
  }

  updateFilterQueryParam() {
    let navigationOptions = {
      replaceUrl: true,
      queryParams: {}
    };
    if (this.filterText) {
      navigationOptions.queryParams = {filter: this.filterText};
    }
    this.router.navigate([], navigationOptions);
  }

  filterRows() {
    this.filteredData = this.rowFilterPipe.transform(this.data, this.filterableFields, this.filterText);
  }

  clearFilterText() {
    this.onFilterTextChange('');
  }

  public firstRequest() {
    this.reload(true);
  }

  public reload(setQueryForm: boolean = false) {
    if (!this.pageData) {
      return;
    }

    if (!this.pageData.methods || !this.pageData.methods.getAll) {
      setTimeout(() => this.toastrService.error('No GET method found in configuration file', 'Error'));
      return;
    }

    this.activeGetRequest = this.pageData.methods.getAll;
    this.fields = this.getDisplayFields(this.activeGetRequest);
    this.filterableFields = this.getFilterableFields(this.fields);
    this.queryParams = this.activeGetRequest.queryParams || [];

    let queryParams = [];
    if (this.queryParams.length) {
      queryParams = this.getQueryParamsValues();

      if (setQueryForm) {
        this.queryForm = this._fb.group(this.getQueryParamsObj());
      }
    }

    this.getRequest(queryParams);
  }

  get requestHeaders(): RequestHeaders {
    return this.activeGetRequest.requestHeaders || this.pageData.requestHeaders || {};
  }

  private getRequest(queryParams = null) {
    if (this.activeGetRequest) {
      this.loading = true;

      this.requestsService.get(this.activeGetRequest.url, this.requestHeaders, queryParams || this.queryParams).subscribe(data => {
        this.loading = false;
        this.data = this.dataPathUtils.extractDataFromResponse(data, this.activeGetRequest.dataPath);

        let sortBy = this.activeGetRequest.display.sortBy;
        if (sortBy) {
          this.data = orderBy(this.data, sortBy);
        }

        this.filterRows();

        if (environment.logApiData) {
          console.log('Got data after dataPath: ', this.data);
        }
      }, error => {
        this.loading = false;
        this.toastrService.error(error, 'Error');
      });
    }
  }

  public getResults() {
    const queryParams = this.getQueryParamsValues();
    this.getRequest(queryParams);
  }

  public extractFieldUrl(field, value) {
    if (!field.url) {
      return value;
    }

    return field.url.replace(`:${field.name}`, value);
  }

  private getQueryParamsValues() {
    const queryParams = [];
    for (const param in this.queryForm.controls) {
      const type = this.getQueryParamType(param);
      let value = this.queryForm.controls[param].value || '';

      if (type === 'encode') {
        value = encodeURIComponent(value);
      }

      queryParams.push({
        name: param,
        value
      });
    }
    return queryParams;
  }

  private getQueryParamType(name = '') {
    if (!name || !this.queryParams || !this.queryParams.length) {
      return null;
    }

    for (const param of this.queryParams) {
      if (param.name === name) {
        return param.type || null;
      }
    }

    return null;
  }

  private getQueryParamsObj() {
    const obj = {};
    if (!this.queryParams) {
      return obj;
    }
    for (const param of this.queryParams) {
      const value =
        param.default !== undefined ? param.default :
          param.value !== undefined ? param.value :
            '';
      obj[param.name] = new FormControl(value);
    }
    return obj;
  }

  private getDisplayFields(params) {
    if (!params.display || !params.display.fields || !params.display.fields.length) {
      setTimeout(() => this.toastrService.error('No display defined in configuration file', 'Error'));
      return [];
    }
    return params.display.fields;
  }

  private getFilterableFields(fields: Array<any>): Array<any> {
    return fields.filter(field => field.filterable);
  }

  protected showActions() {
    let methods = this.pageData && this.pageData.methods;
    if (methods && (methods.delete || methods.put)) {
      return true;
    }
    return false;
  }

  protected delete(row) {
    const reallyDelete = confirm('Are you sure you want to delete this item?');
    if (!reallyDelete) {
      return;
    }
    const deleteMethod = this.pageData.methods.delete;
    let deleteUrl = deleteMethod.url;
    if (!deleteUrl) {
      this.toastrService.error('No delete URL found', 'Error');
      return;
    }
    const dataPath = deleteMethod.dataPath;
    deleteUrl = this.urlUtils.getParsedUrl(deleteUrl, row, dataPath);

    if (environment.logApiData) {
      console.log('Delete url', deleteUrl);
    }

    let actualMethod = this.requestsService.delete.bind(this.requestsService);
    const actualMethodType = this.pageData.methods.delete.actualMethod;
    if (actualMethodType && this.requestsService[actualMethodType]) {
      actualMethod = this.requestsService[actualMethodType].bind(this.requestsService);
    }

    actualMethod(deleteUrl, this.requestHeaders).subscribe(res => {
      this.toastrService.success('Successfully deleted item', 'Success');
      this.getResults();
    }, (error) => {
      this.toastrService.error(error, 'Error');
    });
  }
  
  protected xorHexColor(hexColor) {
    return '#' + (0xffffff ^ parseInt(hexColor.substring(1), 16)).toString(16)
  }

}
