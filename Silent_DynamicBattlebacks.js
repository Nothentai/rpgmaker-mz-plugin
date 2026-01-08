//=============================================================================
// Silent_DynamicBattlebacks.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc 动态战斗背景插件，支持配置敌群对应的多层战斗背景及滚动速度。
 * @author AI之力
 * @url 
 *
 * @param troopSettings
 * @text 敌群战斗背景设置
 * @desc 为不同敌群配置对应的战斗背景
 * @type struct<TroopSetting>[]
 * @default []
 *
 * @help Silent_DynamicBattlebacks.js
 *
 * 该插件允许你为不同敌群配置多层动态战斗背景，包括：
 * - 前景图
 * - 地面图
 * - 背景图
 *
 * 每个图层都可以设置独立的横向滚动速度，以实现动态背景效果。
 *
 * 使用方法：
 * 1. 在插件管理器中配置敌群对应的战斗背景
 * 2. 为每个敌群选择前景图、地面图和背景图
 * 3. 设置各图层的横向滚动速度
 *
 * 注意：
 * - 图片文件应放在 img/battlebacks1 和 img/battlebacks2 文件夹中
 * - 滚动速度为0时表示静态，正数表示向右滚动，负数表示向左滚动
 */

/*~struct~TroopSetting:
 * @param troopId
 * @text 敌群ID
 * @desc 要配置的敌群ID
 * @type troop
 * @default 1
 *
 * @param foreground
 * @text 前景图
 * @desc 战斗背景的前景图
 * @type file
 * @dir img/battlebacks1
 * @default 
 *
 * @param foregroundSpeed
 * @text 前景滚动速度
 * @desc 前景图的横向滚动速度
 * @type number
 * @min -10
 * @max 10
 * @default 0
 *
 * @param ground
 * @text 地面图
 * @desc 战斗背景的地面图
 * @type file
 * @dir img/battlebacks1
 * @default 
 *
 * @param groundSpeed
 * @text 地面滚动速度
 * @desc 地面图的横向滚动速度
 * @type number
 * @min -10
 * @max 10
 * @default 0
 *
 * @param background
 * @text 背景图
 * @desc 战斗背景的背景图
 * @type file
 * @dir img/battlebacks2
 * @default 
 *
 * @param backgroundSpeed
 * @text 背景滚动速度
 * @desc 背景图的横向滚动速度
 * @type number
 * @min -10
 * @max 10
 * @default 0
 */

(() => {
    'use strict';

    // 插件参数
    const pluginName = 'Silent_DynamicBattlebacks';
    const parameters = PluginManager.parameters(pluginName);
    const troopSettings = JSON.parse(parameters.troopSettings || '[]').map(JSON.parse);
    
    // 存储敌群战斗背景配置
    const _troopBattlebackConfigs = {};
    troopSettings.forEach(setting => {
        const troopId = parseInt(setting.troopId);
        _troopBattlebackConfigs[troopId] = {
            foreground: setting.foreground || '',
            foregroundSpeed: parseFloat(setting.foregroundSpeed || 0),
            ground: setting.ground || '',
            groundSpeed: parseFloat(setting.groundSpeed || 0),
            background: setting.background || '',
            backgroundSpeed: parseFloat(setting.backgroundSpeed || 0)
        };
    });

    //-----------------------------------------------------------------------------
    // Sprite_DynamicBattleback
    // 动态战斗背景精灵类
    
    function Sprite_DynamicBattleback() {
        this.initialize(...arguments);
    }
    
    Sprite_DynamicBattleback.prototype = Object.create(TilingSprite.prototype);
    Sprite_DynamicBattleback.prototype.constructor = Sprite_DynamicBattleback;
    
    Sprite_DynamicBattleback.prototype.initialize = function(bitmap, speed, layerType) {
        TilingSprite.prototype.initialize.call(this);
        this.bitmap = bitmap;
        this._speed = speed || 0;
        this._scrollX = 0;
        this._layerType = layerType || 'background';
    };
    
    Sprite_DynamicBattleback.prototype.adjustPosition = function() {
        if (this._layerType === 'foreground') {
            // 前景图保持原始比例，不被拉伸，坐标原点设置为左上角(0,0)
            this.width = this.bitmap.width;
            this.height = this.bitmap.height;
            this.x = 0;
            this.y = 0;
            this.scale.x = 1.0;
            this.scale.y = 1.0;
        } else {
            // 其他图层保持原有的缩放逻辑
            this.width = Math.floor((1000 * Graphics.width) / 816);
            this.height = Math.floor((740 * Graphics.height) / 624);
            this.x = (Graphics.width - this.width) / 2;
            if ($gameSystem.isSideView()) {
                this.y = Graphics.height - this.height;
            } else {
                this.y = 0;
            }
            const ratioX = this.width / this.bitmap.width;
            const ratioY = this.height / this.bitmap.height;
            const scale = Math.max(ratioX, ratioY, 1.0);
            this.scale.x = scale;
            this.scale.y = scale;
        }
    };
    
    Sprite_DynamicBattleback.prototype.update = function() {
        TilingSprite.prototype.update.call(this);
        this.updateScroll();
    };
    
    Sprite_DynamicBattleback.prototype.updateScroll = function() {
        if (this._speed !== 0) {
            this._scrollX += this._speed;
            this.origin.x = this._scrollX;
        }
    };
    
    //-----------------------------------------------------------------------------
    // Spriteset_Battle
    // 重写战斗精灵组以支持动态战斗背景
    
    // 保存原始方法
    const _Spriteset_Battle_createBattleback = Spriteset_Battle.prototype.createBattleback;
    const _Spriteset_Battle_updateBattleback = Spriteset_Battle.prototype.updateBattleback;
    
    // 重写创建战斗背景方法
    Spriteset_Battle.prototype.createBattleback = function() {
        // 首先调用原始方法创建系统默认战斗背景
        _Spriteset_Battle_createBattleback.call(this);
        
        // 然后创建动态战斗背景（如果有配置的话）
        // 注意：这里不再清除原始背景，而是在原始背景上叠加或替换
        this.createDynamicBattleback();
    };
    
    // 创建动态战斗背景
    Spriteset_Battle.prototype.createDynamicBattleback = function() {
        // 重置定位标志，确保adjustPosition会被调用
        this._battlebackLocated = false;
        
        // 清除之前创建的动态战斗背景精灵
        if (this._groundSprite) {
            this._baseSprite.removeChild(this._groundSprite);
            this._groundSprite = null;
        }
        if (this._backgroundSprite) {
            this._baseSprite.removeChild(this._backgroundSprite);
            this._backgroundSprite = null;
        }
        if (this._foregroundSprite) {
            this._baseSprite.removeChild(this._foregroundSprite);
            this._foregroundSprite = null;
        }
        
        const config = this.getCurrentBattlebackConfig();
        
        // 如果配置了动态背景图层，则替换原始背景
        let hasDynamicBackground = false;
        
        // 创建地面图（最底层）
        if (config.ground) {
            // 清除原始地面背景
            if (this._back1Sprite) {
                this._baseSprite.removeChild(this._back1Sprite);
                this._back1Sprite = null;
            }
            const bitmap = ImageManager.loadBattleback1(config.ground);
            this._groundSprite = new Sprite_DynamicBattleback(bitmap, config.groundSpeed, 'ground');
            this._baseSprite.addChild(this._groundSprite);
            hasDynamicBackground = true;
        }
        
        // 创建背景图（中间层）
        if (config.background) {
            // 清除原始背景图
            if (this._back2Sprite) {
                this._baseSprite.removeChild(this._back2Sprite);
                this._back2Sprite = null;
            }
            const bitmap = ImageManager.loadBattleback2(config.background);
            this._backgroundSprite = new Sprite_DynamicBattleback(bitmap, config.backgroundSpeed, 'background');
            this._baseSprite.addChild(this._backgroundSprite);
            hasDynamicBackground = true;
        }
        
        // 创建前景图（最上层）
        if (config.foreground) {
            const bitmap = ImageManager.loadBattleback1(config.foreground);
            this._foregroundSprite = new Sprite_DynamicBattleback(bitmap, config.foregroundSpeed, 'foreground');
            this._baseSprite.addChild(this._foregroundSprite);
            hasDynamicBackground = true;
        }
        
        // 如果有动态背景，确保原始背景不再影响显示
        if (hasDynamicBackground) {
            // 确保原始背景精灵不会显示
            if (this._back1Sprite) {
                this._back1Sprite.visible = false;
            }
            if (this._back2Sprite) {
                this._back2Sprite.visible = false;
            }
        }
    };
    
    // 获取当前敌群的战斗背景配置
    Spriteset_Battle.prototype.getCurrentBattlebackConfig = function() {
        const troopId = $gameTroop.troop().id;
        return _troopBattlebackConfigs[troopId] || {
            foreground: '',
            foregroundSpeed: 0,
            ground: '',
            groundSpeed: 0,
            background: '',
            backgroundSpeed: 0
        };
    };
    
    // 重写更新战斗背景方法
    Spriteset_Battle.prototype.updateBattleback = function() {
        // 先保存原始背景精灵的引用
        const originalBack1 = this._back1Sprite;
        const originalBack2 = this._back2Sprite;
        
        // 只有在原始背景精灵存在时才调用原始方法
        if (originalBack1 && originalBack2) {
            try {
                _Spriteset_Battle_updateBattleback.call(this);
            } catch (e) {
                // 忽略原始方法的错误，继续执行我们的更新逻辑
            }
        }
        
        // 然后更新动态战斗背景
        if (!this._battlebackLocated) {
            if (this._backgroundSprite && typeof this._backgroundSprite.adjustPosition === 'function') {
                this._backgroundSprite.adjustPosition();
            }
            if (this._groundSprite && typeof this._groundSprite.adjustPosition === 'function') {
                this._groundSprite.adjustPosition();
            }
            if (this._foregroundSprite && typeof this._foregroundSprite.adjustPosition === 'function') {
                this._foregroundSprite.adjustPosition();
            }
            this._battlebackLocated = true;
        }
    };

})();
